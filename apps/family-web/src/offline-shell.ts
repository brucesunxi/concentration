let installation:Promise<ServiceWorkerRegistration>|undefined;
export async function shellReady() {
  if(!import.meta.env.PROD || !('serviceWorker' in navigator) || !isSecureContext)return false;
  try {
    installation ??= navigator.serviceWorker.register('/focus-sw.js',{scope:'/',updateViaCache:'none'}).catch(error=>{installation=undefined;throw error;});
    await installation;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),12000);})]).finally(()=>clearTimeout(timer));
    if(!registration?.active)return false;
    return await new Promise<boolean>(resolve=>{
      const channel=new MessageChannel();
      const finish=(ready:boolean)=>{clearTimeout(timer);channel.port1.close();resolve(ready);};
      const timer=setTimeout(()=>finish(false),3000);
      channel.port1.onmessage=event=>finish(event.data?.type==='FOCUS_SHELL_STATUS'&&event.data.ready===true);
      registration.active!.postMessage({type:'FOCUS_SHELL_STATUS',entryPath:new URL(import.meta.url).pathname},[channel.port2]);
    });
  }catch{return false;}
}

/** Browser releases the lock on process death; normal exit waits for accepted writes. */
export async function acquirePracticeLock():Promise<()=>void> {
  if(!navigator.locks)throw new Error('PRACTICE_LOCK_UNAVAILABLE');
  return new Promise((resolve,reject)=>{
    void navigator.locks.request('focus-family-practice',{ifAvailable:true},async lock=>{
      if(!lock){reject(new Error('PRACTICE_OPEN_ELSEWHERE'));return;}
      await new Promise<void>(release=>resolve(release));
    }).catch(reject);
  });
}
