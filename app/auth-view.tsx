"use client";

import { useState } from "react";
import Image from "next/image";
import { clientFetch as fetch } from "@/lib/client-polling.mjs";

// Login/register screen. Kept out of `authenticated-app.tsx` so the unauthenticated
// entry point does not pull the trading-console chunk. Both `app/page.tsx` and the
// re-authentication path inside the console import it from here.
type UiTheme = "dark" | "light";
type MembershipPlanId = "day"|"monthly"|"yearly";
type Membership = { active:boolean; planId:MembershipPlanId|null; expiresAt:string|null; referralCode:string|null; referralCredits:number; referralReviews:number; referralRewardDays:number };

export function AuthView({onAuthenticated,onBack,onDemo,theme,onToggleTheme}:{onAuthenticated:(name:string,isNew:boolean,remember:boolean,membership:Membership|null)=>void;onBack:()=>void;onDemo:()=>void;theme:UiTheme;onToggleTheme:()=>void}) {
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [remember,setRemember]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [agreed,setAgreed]=useState(false);
  const [resetMode,setResetMode]=useState(false);
  const [resetToken,setResetToken]=useState('');
  const [referralCode]=useState(()=>typeof window==='undefined'?'':(new URLSearchParams(window.location.search).get('ref')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16));
  const strength=password.length<8?0:Number(/[A-Z]/.test(password))+Number(/[a-z]/.test(password))+Number(/\d/.test(password))+Number(/[^A-Za-z0-9]/.test(password));
  const requestReset=async()=>{
    const name=username.trim();
    if(name.length<3){setError('请先输入需要找回的账号');return;}
    setBusy(true);setError('');
    try{const response=await fetch('/api/control/auth/reset-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name})});const payload=await response.json();setResetMode(true);setError(payload.message||'申请已记录，请联系管理员获取一次性重置码。');}
    catch{setError('暂时无法提交找回申请，请稍后重试');}finally{setBusy(false)}
  };
  const submit=async()=>{
    setError('');
    const name=username.trim();
    if(resetMode){
      if(!resetToken.trim()){setError('请输入管理员提供的一次性重置码');return;}
      if(password.length<8){setError('新密码至少需要 8 个字符');return;}
      setBusy(true);
      try{const response=await fetch('/api/control/auth/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:resetToken.trim(),password})});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'重置码无效');setResetMode(false);setResetToken('');setError(payload.message||'密码已更新，请重新登录。');}
      catch(error){setError(error instanceof Error?error.message:'密码重置失败');}finally{setBusy(false)}
      return;
    }
    if(name.length<3){setError('用户名至少需要 3 个字符');return;}
    if(password.length<8){setError('密码至少需要 8 个字符');return;}
    if(mode==='register'&&password!==confirm){setError('两次输入的密码不一致');return;}
    if(mode==='register'&&!agreed){setError('请先阅读并同意用户协议和隐私政策');return;}
    setBusy(true);
    try{
      const response=await fetch(`/api/control/auth/${mode==='register'?'register':'login'}`,{
        method:'POST',headers:{'content-type':'application/json'},credentials:'include',
        body:JSON.stringify({username:name,password,displayName:name,remember:mode==='register'?true:remember,referralCode:mode==='register'?referralCode:undefined}),
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'账号服务暂不可用');
      localStorage.setItem('rabbit-account-role',payload.user?.role||'member');
      onAuthenticated(payload.user?.displayName||payload.user?.username||name,mode==='register',remember,payload.user?.membership??null);
    }catch(error){setError(error instanceof Error?error.message:'账号服务暂不可用，请稍后重试');}finally{setBusy(false);}
  };
  return <main className="auth-page">
    <div className="auth-entry-floating">
      <button type="button" onClick={onBack}>← 产品首页</button>
      <span><a href="/terms" target="_blank" rel="noreferrer">用户协议</a><i/> <a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a></span>
      <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={theme==='dark'?'切换到白天模式':'切换到黑夜模式'} title={theme==='dark'?'白天模式':'黑夜模式'}><span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span></button>
      <button type="button" onClick={onDemo}>免注册演示</button>
    </div>
    <section className="auth-brand-panel"><div className="auth-brand"><Image className="brand-primary-logo" src="/double-rabbit-assistant-brand.png" alt="双兔助手双兔无限线品牌标志" width={280} height={72} priority/><span><b aria-label="双兔助手 做T神器"><span aria-hidden="true">双兔助手</span></b><small>做T神器 · RABBIT QUANT</small></span></div><div className="auth-message"><span className="eyebrow">RABBIT SMART‑T</span><h1>把复杂的盘面，<br/><em>变成简单的操作。</em></h1><p>多股监控、正反T决策、当日仓位闭环与四兔持续训练。</p></div><div className="auth-points"><span><i/>市场雷达硬门控</span><span><i/>T+1可卖数量校验</span><span><i/>收盘恢复计划底仓</span></div><small className="auth-disclaimer">策略研究工具 · 不构成投资建议</small></section>
    <section className="auth-form-panel"><div className="auth-card"><div className="auth-card-head"><span>{resetMode?'RESET PASSWORD':mode==='login'?'WELCOME BACK':'CREATE ACCOUNT'}</span><h2>{resetMode?'使用一次性重置码':mode==='login'?'登录做T神器':'创建服务器账户'}</h2><p>{resetMode?'输入管理员提供的 30 分钟有效重置码，并设置新密码。':mode==='login'?'继续查看你的监控、回测和训练记录。':'注册后可在电脑和手机使用同一监控清单。'}</p></div><div className="auth-tabs"><button className={mode==='login'&&!resetMode?'active':''} onClick={()=>{setMode('login');setResetMode(false);setError('')}}>登录</button><button className={mode==='register'?'active':''} onClick={()=>{setMode('register');setResetMode(false);setError('')}}>注册</button></div>{mode==='register'&&!resetMode&&referralCode&&<div className="auth-referral"><b>已绑定邀请</b><span>{referralCode}</span><small>完成有效注册后，邀请人将获得 7 天内测权益。</small></div>}<label className="auth-field"><span>账号</span><input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="用户名或邮箱"/></label>{resetMode&&<label className="auth-field"><span>一次性重置码</span><input value={resetToken} onChange={e=>setResetToken(e.target.value)} autoComplete="one-time-code" placeholder="粘贴管理员提供的重置码"/></label>}<label className="auth-field"><span>{resetMode?'新密码':'密码'}</span><div><input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?'text':'password'} autoComplete={mode==='login'&&!resetMode?'current-password':'new-password'} placeholder="至少 8 个字符"/><button onClick={()=>setShowPassword(!showPassword)} type="button">{showPassword?'隐藏':'显示'}</button></div></label>{mode==='register'&&!resetMode&&<><div className="password-strength"><span>密码强度</span><i className={strength>0?'on':''}/><i className={strength>1?'on':''}/><i className={strength>2?'on':''}/><i className={strength>3?'on':''}/><b>{strength<2?'较弱':strength<4?'可用':'较强'}</b></div><label className="auth-field"><span>确认密码</span><input value={confirm} onChange={e=>setConfirm(e.target.value)} type={showPassword?'text':'password'} autoComplete="new-password" placeholder="再次输入密码"/></label><label className="terms-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span>我已阅读并同意《用户协议》和《隐私政策》，理解本工具不构成投资建议。</span></label></>}{mode==='login'&&!resetMode&&<div className="auth-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>记住登录</span></label><button type="button" onClick={()=>void requestReset()}>忘记密码？</button></div>}{resetMode&&<div className="auth-options"><span>重置后旧设备会自动退出</span><button type="button" onClick={()=>{setResetMode(false);setError('')}}>返回登录</button></div>}{error&&<div className="auth-error"><i>!</i>{error}</div>}<button className="auth-submit" onClick={submit} disabled={busy}>{busy?'正在验证…':resetMode?'更新密码':mode==='login'?'登录':'注册并进入'}<span>→</span></button><div className="auth-local-note"><i>i</i><p><b>服务器账户</b><span>账号、监控股票和持仓设置保存在服务器，可跨设备同步；密码仅保存为不可逆哈希。</span></p></div></div><footer className="auth-footer">© 2026 Rabbit Quant · 用户协议 · 隐私政策</footer></section>
  </main>;
}
