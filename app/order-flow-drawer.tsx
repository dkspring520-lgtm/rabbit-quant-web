"use client";
import {useEffect,useRef,type ReactNode} from 'react';

export default function OrderFlowDrawer({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current;
    if(!dialog)return;
    if(open&&!dialog.open)dialog.showModal();
    if(!open&&dialog.open)dialog.close();
  },[open]);
  return <dialog className="flow-detail-drawer" ref={ref} aria-label={title} onCancel={onClose} onClose={onClose} style={{position:'fixed',inset:'0 0 0 auto',margin:0,width:'min(460px, 100%)',maxWidth:'100%',height:'100dvh',maxHeight:'100dvh',boxSizing:'border-box',border:'1px solid var(--border)',padding:20,background:'var(--surface, #141b26)',color:'var(--text, #eee)',overflowY:'auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',marginBottom:20}}><h2 style={{margin:0,fontSize:18}}>{title}</h2><button type="button" autoFocus onClick={onClose} aria-label="关闭详情">关闭 ×</button></header>
    {children}
  </dialog>;
}
