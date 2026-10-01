'use client'
import {useEffect,useState} from 'react'
import {getQueuedWrites,getQueueOwner,retryReviewedWrite,subscribeOfflineQueueCount,type QueuedWrite} from '@/lib/offlineQueue'
import {flushOfflineQueueOnStartup} from '@/lib/api'
export function PendingOperations({count}:{count:number}) {
  const [items,setItems]=useState<QueuedWrite[]>([]),[error,setError]=useState('')
  useEffect(()=>{let alive=true;const unsubscribe=subscribeOfflineQueueCount(()=>{const owner=getQueueOwner();if(owner)void getQueuedWrites(owner).then(rows=>{if(alive&&owner===getQueueOwner())setItems(rows)}).catch(err=>{if(alive)setError(String(err))});else setItems([])});return()=>{alive=false;unsubscribe()}},[])
  async function retry(item:QueuedWrite) {
    try {await retryReviewedWrite(item.id,item.owner);setItems(await getQueuedWrites(item.owner));flushOfflineQueueOnStartup()}catch(err){setError(String(err))}
  }
  function download() {
    const blob=new Blob([JSON.stringify({owner:getQueueOwner(),exportedAt:new Date().toISOString(),operations:items},null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='hisvex-pending-operations.json';link.click();URL.revokeObjectURL(url)
  }
  return <details style={{padding:'8px 20px',borderBottom:'1px solid var(--color-border)'}}>
    <summary>Navbatni tekshirish ({count})</summary>
    <p>Bu amallar saqlangan. Ularni yangi savdo sifatida qayta kiritmang. Rad etilgan amalni qayta yuborishdan oldin sababini tekshiring.</p>
    {items.length<count&&<p role="alert">Ayrim yozuvlar o‘qilmadi. Brauzer ma’lumotlarini tozalamang; tiklash uchun administratorga murojaat qiling.</p>}
    {error&&<p role="alert">{error}</p>}
    <button onClick={download}>O‘qilgan yozuvlar nusxasini yuklab olish</button>
    <ul>{items.map(item=><li key={item.id} style={{margin:'10px 0'}}>
      <span>{new Date(item.createdAt).toLocaleString()} — {item.lastError??'Server tasdig‘i kutilmoqda'}</span>
      <div style={{fontSize:12}}>Amal: {item.id}</div>
      {item.lastError&&<button onClick={()=>void retry(item)}>Tekshirdim, shu amalni qayta yuborish</button>}
    </li>)}</ul>
  </details>
}
