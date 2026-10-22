import { useEffect, useState } from "react";
import { api } from "@/api/client";

const EARTH_RADIUS_MI = 3958.8;
const THRESHOLD_MI = 50;

function haversineMi(lat1, lon1, lat2, lon2){
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

// "Don't show again" is kept on the profile, so it holds on every device, and
// in this browser too, so it holds at once even if that save fails.
const OFF_KEY = 'kc_travel_banner_off';
const offHere = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } };

async function reverseGeocode(latitude, longitude){
  try{
    const { city, country_code, timezone }=await api.geo.reverse(latitude, longitude);
    return { city, country_code, timezone };
  }catch{ return { city:'', country_code:'', timezone:'' }; }
}

// Where the browser says this device is, only when the member already allowed
// it — never a permission prompt, and never a guess from the internet
// connection. That guess is what made the banner fire for members sitting at
// home (the admin account included): a connection resolves to its provider's
// city, which can be anywhere, and a time zone that merely differs is not
// travel either. Returns null when the browser cannot say.
async function browserLocation(){
  try{
    if(!navigator.geolocation || !navigator.permissions) return null;
    const perm = await navigator.permissions.query({name:'geolocation'});
    if(perm.state !== 'granted') return null;
    const pos = await new Promise((resolve, reject)=>navigator.geolocation.getCurrentPosition(resolve, reject, { timeout:10000, maximumAge:300000 }));
    const { latitude, longitude }=pos.coords;
    const { city, country_code, timezone }=await reverseGeocode(latitude, longitude);
    let tzid=timezone;
    if(!tzid){ try{ tzid=Intl.DateTimeFormat().resolvedOptions().timeZone; }catch{} }
    return { latitude, longitude, city, country_code, tzid };
  }catch{ return null; }
}

// Offers to update the saved location when the browser's location is at least
// 50 miles from it. Purely informational — does NOT touch the Shabbos gate,
// getShabbosStatus, or any saved location. Dismissing it is for good.
export function useTravelCheck(){
  const [suggestion, setSuggestion]=useState(null);
  useEffect(()=>{
    let cancelled=false;
    const run=async()=>{
      try{
        if(offHere() || !(await api.auth.hasAccount())) return;
        const me=await api.auth.me();
        if(me.guest || me.travel_banner_off) return;
        if(me.latitude==null || me.longitude==null) return; // no saved location yet — handled by the "location required" prompt
        const fresh=await browserLocation();
        if(cancelled || !fresh) return;
        if(haversineMi(me.latitude, me.longitude, fresh.latitude, fresh.longitude) < THRESHOLD_MI) return;
        setSuggestion(fresh);
      }catch{}
    };
    run();
    const id=setInterval(run, 30*60*1000);
    return ()=>{ cancelled=true; clearInterval(id); };
  },[]);
  const dismiss=async ()=>{
    setSuggestion(null);
    try{ localStorage.setItem(OFF_KEY, '1'); }catch{}
    try{ await api.auth.updateMe({ travel_banner_off:true }); }catch{}
  };
  return { suggestion, dismiss };
}
