import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

export class VisitStore{
  #file;#key;#queue=Promise.resolve();
  constructor(directory,key,{filename='visits.enc'}={}){this.#file=path.join(path.resolve(directory),filename);this.#key=key;}
  async init(){await fs.mkdir(path.dirname(this.#file),{recursive:true,mode:0o700});await this.read();}
  async read(){
    try{
      const envelope=JSON.parse(await fs.readFile(this.#file,'utf8'));
      const decipher=createDecipheriv('aes-256-gcm',this.#key,Buffer.from(envelope.iv,'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
      const data=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]);
      const rows=JSON.parse(data.toString('utf8'));
      if(!Array.isArray(rows))throw new Error('Invalid stored data');
      return rows;
    }catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  async #write(rows){
    const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.#key,iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(rows),'utf8'),cipher.final()]);
    const temp=this.#file+'.'+randomBytes(6).toString('hex')+'.tmp';
    await fs.writeFile(temp,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});
    await fs.rename(temp,this.#file);
  }
  change(fn){
    const operation=this.#queue.then(async()=>{
      const now=Date.now();
      const rows=(await this.read()).filter(row=>row.retentionUntil?Date.parse(row.retentionUntil)>now:Date.parse(row.createdAt)>now-30*24*60*60*1000);
      const result=await fn(rows);await this.#write(rows);return result;
    });
    this.#queue=operation.catch(()=>{});return operation;
  }
}
