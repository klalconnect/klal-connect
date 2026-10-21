import React,{useEffect,useRef,useState} from 'react';
import { api } from '@/api/client';
import useVouchesEnabled from '@/hooks/useVouchesEnabled';
import ListingLocationPicker from '@/components/ListingLocationPicker';
import CityInput, { StateSelect, stateForPlace } from '@/components/CityInput';
import HeadlineEdit from '@/components/HeadlineEdit';
import { badgesForCategory } from '@/lib/badges';
import { KITCHENS, kitchenAppliesTo } from '@/lib/kitchen';
import { categoryLabel } from '@/lib/categories';
import { GALLERY_MAX } from '@/lib/listing';
import MinyanEditor from '@/components/MinyanEditor';
import { isShulListing } from '@/lib/minyanim';
import { COUNTRIES, countryName, countryOf, US } from '@/lib/countries';
import { US_STATES } from '@/components/CityInput';
const blank={name:'',tagline:'',category:'',subcategory:'',short_description:'',description:'',address:'',city:'',state:'',country:'',zip:'',phone:'',text_phone:'',email:'',website:'',hours:'',service_areas:'',languages:'English',delivery_mode:'in_person',whatsapp:'',payment_link_url:'',badges:[],gallery:[],minyanim:[],minyan_url:'',kitchen:''};
// initialCategory arrives from /add?category=… — an empty category tile on the
// homepage asking for the first listing of that kind. initialName and
// sourcePostId arrive from /add?from_post=… — an answer to an ask being turned
// into a listing, with source_post_id kept on the row so the directory can
// show where its listings actually come from.
// A provider prop turns this into an edit form. The fields are the same ones,
// which is the point: a separate edit form listing twenty fields would drift
// from this one within a month, and the two would then disagree about what a
// listing is.
// The map pin's own fields. They are not in `blank` because the picker writes
// them rather than the person, but they have to come back in on an edit: left
// out, the picker read an existing pin as "No pin yet.", there was no way to
// move or remove one, and a business that moved kept the old address's pin.
const PICKER_FIELDS = ['latitude', 'longitude', 'country_code'];
const fromProvider = (row) => ({
  ...blank,
  // Only the fields this form owns. Everything else on the row — slug,
  // counters, verification — is not ours to round-trip.
  ...Object.fromEntries(Object.entries(row || {}).filter(([k]) => k in blank || PICKER_FIELDS.includes(k))),
  service_areas: Array.isArray(row?.service_areas) ? row.service_areas.join(', ') : (row?.service_areas || ''),
  languages: Array.isArray(row?.languages) ? row.languages.join(', ') : (row?.languages || 'English'),
  badges: Array.isArray(row?.badges) ? row.badges : [],
  gallery: Array.isArray(row?.gallery) ? row.gallery : [],
  minyanim: Array.isArray(row?.minyanim) ? row.minyanim : [],
  // A listing from before countries were recorded shows the one its state
  // implies, and is saved with it on the next save.
  country: countryOf(row),
});
// Shown when Save is pressed mid-upload, and taken down by itself once the
// upload lands — it used to stay next to "New image ready" until the next click.
const STILL_UPLOADING='Your image is still uploading — one moment.';
// `logo` is '' while the stored image is left alone, a URL once a new one has
// uploaded, and null when the person has asked for the stored one to come
// down. The third state is what lets an edit send logo_url: '' at all.
export default function ListingForm({initialCategory='',initialName='',sourcePostId='',provider=null,ownerEdit=false}){const vouchesOn=useVouchesEnabled();const [data,setData]=useState(()=>(provider?fromProvider(provider):{...blank,category:initialCategory,name:initialName})),[categories,setCategories]=useState([]),[done,setDone]=useState(false),[mine,setMine]=useState(false),[claimed,setClaimed]=useState(false),[logo,setLogo]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[uploadErr,setUploadErr]=useState(''),[galleryUploading,setGalleryUploading]=useState(false);const logoInput=useRef(null),uploadSeq=useRef(0);useEffect(()=>{api.entities.Category.list('order').then(setCategories)},[]);const change=e=>setData({...data,[e.target.name]:e.target.value});
  // The upload used to be fire-and-forget: a rejected request (too large, not
  // an image, storage down, session expired) threw inside the change handler
  // where nothing caught it, so the input looked accepted and `logo` stayed
  // empty. On an edit that meant logo_url was left out of the patch, the patch
  // was often empty, and the form said "Your changes are live" having sent
  // nothing. The same happened to someone who clicked Save while the upload
  // was still in flight. Every outcome now shows on the page, and Save waits.
  //
  // The input is disabled while a file is in flight, and each upload carries a
  // sequence number so only the latest one's outcome is applied: two quick
  // picks on a slow connection used to let the first file's URL land after the
  // second was chosen, and Save then stored the image the person had replaced.
  const forgetUpload=()=>{ setUploadErr(''); if(logoInput.current) logoInput.current.value=''; };
  const upload=async e=>{
    const file=e.target.files?.[0]; if(!file) return;
    const seq=++uploadSeq.current;
    setUploading(true);setUploadErr('');setErr('');setLogo('');
    try{ const {file_url}=await api.integrations.Core.UploadFile({file}); if(seq!==uploadSeq.current) return; if(!file_url) throw new Error('The image was not saved. Please try again.'); setLogo(file_url); }
    catch(error){ if(seq!==uploadSeq.current) return; setUploadErr(error.message||'Could not upload that image.'); if(logoInput.current) logoInput.current.value=''; }
    finally{ if(seq===uploadSeq.current){ setUploading(false); setErr(cur=>cur===STILL_UPLOADING?'':cur); } }
  };
  // The gallery's own uploads report in here, so Save waits for them the same
  // way it waits for the logo. Before this a photo picked a second before Save
  // was simply not in the patch, and its URL arrived in state nobody was
  // looking at any more.
  const galleryBusy=(on)=>{ setGalleryUploading(on); if(!on) setErr(cur=>cur===STILL_UPLOADING?'':cur); };
  const submit=async e=>{
    e.preventDefault();
    if(busy)return;
    if(uploading||galleryUploading){ setErr(STILL_UPLOADING); return; }
    // A failed upload is not a reason to hold the rest of the form hostage:
    // the patch carries no new logo in that state, so the phone number or
    // hours this person also changed can still be saved. The error stays on
    // the page next to the input until they dismiss it or pick again.
    if (!(await api.auth.requireAccount())) return;
    setBusy(true);setErr('');
    const fields={...data,logo_url:logo===null?'':(logo||(provider?.logo_url||'')),service_areas:data.service_areas.split(',').map(x=>x.trim()).filter(Boolean),languages:data.languages.split(',').map(x=>x.trim()).filter(Boolean)};
    if(provider){
      // Only what actually changed. Both stores merge a patch server-side, so
      // sending all twenty-two fields was not wrong so much as destructive:
      // whoever opened the form last wrote their stale copy of every other
      // field over whatever had been saved in the meantime — a correction by
      // the business, a fix by a moderator — and nothing showed that it had
      // happened. A patch of the fields this person touched cannot do that.
      // Status, verification and the prominence fields are stripped by the
      // route, so editing is still not a way to promote yourself.
      const before=fromProvider(provider);
      const same=(a,b)=>Array.isArray(a)||Array.isArray(b)
        ? JSON.stringify([...(a||[])].sort())===JSON.stringify([...(b||[])].sort())
        : (a??'')===(b??'');
      const patch=Object.fromEntries(Object.entries(fields).filter(([k,v])=>{
        // Sent when it differs from what is stored: a new upload, or '' to
        // take the stored image down. Untouched, it stays out of the patch.
        if(k==='logo_url') return v!==(provider.logo_url||'');
        // These two are the lossy ones: an array joined with ", " into one text
        // input and split on "," again. A stored area like "Brooklyn, NY" comes
        // apart into "Brooklyn" and a bogus "NY" — on any save, including one
        // that changed the hours. So the comparison is on the text this person
        // was actually shown: untouched text sends nothing, and a split only
        // happens to someone who typed in a field labelled "comma separated".
        if(k==='service_areas'||k==='languages') return data[k]!==before[k];
        // Objects, not ids: the generic sort-and-compare above turns each photo
        // into "[object Object]" and would call any two galleries equal.
        if(k==='gallery'||k==='minyanim') return JSON.stringify(v)!==JSON.stringify(before[k]);
        // Against what is stored, not what the box was filled with: a listing
        // with no country shows the one its state implies, and leaving it
        // there used to save nothing. What the box shows is what gets saved.
        if(k==='country') return !same(v,provider.country);
        return !same(v,before[k]);
      }));
      // Saying "Your changes are live" over an empty patch is how a lost
      // upload went unnoticed for weeks. Nothing changed, so say that.
      if(!Object.keys(patch).length){ setErr('Nothing has changed yet, so there is nothing to save.'); setBusy(false); return; }
      try{ const updated=await api.entities.Provider.update(provider.id,patch); setDone(updated||true); }
      catch(error){ setErr(/not permitted/i.test(error.message||'')
        ? 'This listing is not yours to edit — only its accepted owner and the Klal team can change it. Your changes have not been saved. You can suggest a correction from the listing page.'
        : (error.message||'Could not save those changes')); }
      finally{ setBusy(false); }
      return;
    }
    const r=await api.functions.invoke('createListing',{...fields,source_post_id:sourcePostId||undefined,claim_as_owner:mine||undefined});
    if(r.status>=400){setErr(r.data?.error||'Could not submit');setBusy(false);return;}
    setClaimed(!!r.data?.claim);
    setDone(r.data?.provider||true);
  };if(done)return <div className="success p-6">{provider
    ? <>Your changes are live. <a className="underline" href={`/provider/${provider.slug||provider.id}`}>See the listing</a>.</>
    : <>Your listing is live. Thank you for helping our community grow — {done.id?<a className="underline" href={`/provider/${done.id}`}>see it in the directory</a>:'find it in the directory'}, share it on WhatsApp{vouchesOn ? ', and ask people who know your work to vouch for it' : ''}.
      {/* Adding a listing does not make it yours to edit, so say what does. */}
      <span className="mt-3 block">{claimed
        ? 'We have your request to manage it as the owner. Once the Klal team accepts it, you can edit the listing yourself.'
        : 'Need to change something later? Use "Suggest a Correction" on the listing page and the Klal team will update it.'}</span></>}</div>;return <form onSubmit={submit} className="space-y-5"><div className="form-grid"><Field label="Business or resource name" name="name" value={data.name} onChange={change} required/><label>Category<select className="field" name="category" value={data.category} onChange={change} required><option value="">Choose a category</option>{data.category&&categories.length>0&&!categories.some(c=>c.name===data.category)&&<option value={data.category}>{categoryLabel(data.category)}</option>}{categories.map(c=><option key={c.id} value={c.name}>{categoryLabel(c.name)}</option>)}</select></label><Field label="Subcategory" name="subcategory" value={data.subcategory} onChange={change} list="kc-subcategories" autoComplete="off" placeholder={data.category==='Other'?'Say what it is — this is what people will search for':(categories.find(c=>c.name===data.category)?.subcategories||[]).length?'Pick one or type your own':''}/><datalist id="kc-subcategories">{(categories.find(c=>c.name===data.category)?.subcategories||[]).map(s=><option key={s} value={s}/>)}</datalist><Field label="Short description" name="short_description" value={data.short_description} onChange={change} required/><label>City<CityInput value={data.city} onChange={v=>setData(d=>({...d,city:v}))} onPick={p=>setData(d=>({...d,city:p.city,state:stateForPlace(p,d.state),country:countryName(p.country_code)||d.country,latitude:p.latitude,longitude:p.longitude,country_code:p.country_code||d.country_code}))} required={!provider}/></label><label>State or region<StateSelect value={data.state} onChange={v=>setData(d=>({...d,state:v,country:US_STATES.some(([code])=>code===v)?US:d.country}))}/></label><label>Country<CountryField value={data.country} onChange={v=>setData(d=>({...d,country:v}))} required={!provider}/></label><Field label="ZIP code" name="zip" value={data.zip} onChange={change}/><Field label="Address (optional)" name="address" value={data.address} onChange={change}/><Field label="Phone" name="phone" value={data.phone} onChange={change}/><Field label="Text-enabled phone" name="text_phone" value={data.text_phone} onChange={change}/><Field label="WhatsApp number (with country code)" name="whatsapp" value={data.whatsapp} onChange={change} placeholder="1 732 555 0100"/><Field label="Payment link (optional)" name="payment_link_url" value={data.payment_link_url} onChange={change} placeholder="Stripe Payment Link, PayPal.me, Venmo…"/><Field label="Email" name="email" type="email" value={data.email} onChange={change}/><Field label="Website" name="website" value={data.website} onChange={change}/><Field label="Hours" name="hours" value={data.hours} onChange={change}/><Field label="Areas served (comma separated)" name="service_areas" value={data.service_areas} onChange={change}/><Field label="Languages (comma separated)" name="languages" value={data.languages} onChange={change}/><label>Service format<select className="field" name="delivery_mode" value={data.delivery_mode} onChange={change}><option value="in_person">In person</option><option value="remote">Remote</option><option value="both">Both</option></select></label></div><HeadlineEdit label="Tagline" value={data.tagline||''} onChange={v=>setData({...data,tagline:v})} helper="Appears under your listing name across the app."/>
<ListingLocationPicker value={data} onChange={loc=>setData(d=>({...d,...loc}))}/>
{kitchenAppliesTo(data.category)&&<KitchenPicker value={data.kitchen} onChange={kitchen=>setData(d=>({...d,kitchen}))}/>}
<BadgePicker category={data.category} value={data.badges} onChange={badges=>setData(d=>({...d,badges}))}/>
{isShulListing(data)&&<MinyanEditor value={data.minyanim} onChange={m=>setData(d=>({...d,minyanim:typeof m==='function'?m(d.minyanim):m}))} link={data.minyan_url} onLink={v=>setData(d=>({...d,minyan_url:v}))}/>}
{/* Required to add a listing, optional to save one. createListing asks for
      a name and a category and nothing else, so a listing that reached the
      directory through the API or an older form can be missing either of
      these — and an owner fixing a phone number was told to write a full
      description first or lose the change. */}<label className="block">Full description<textarea className="field min-h-32" name="description" value={data.description} onChange={change} required={!provider}/></label><div className="space-y-2"><label className="block">Logo or main image<input ref={logoInput} type="file" accept="image/*" onChange={upload} disabled={uploading} className="field" aria-busy={uploading||undefined}/></label>{uploading&&<p className="helper text-sm">Uploading…</p>}{uploadErr&&<p className="text-sm font-semibold text-brand-error" role="alert">{uploadErr} <button type="button" className="underline" onClick={forgetUpload}>Dismiss</button></p>}{logo===null&&provider?.logo_url&&<p className="helper text-sm">The current image comes down when you save. <button type="button" className="underline" onClick={()=>setLogo('')}>Keep it</button></p>}{logo!==null&&(logo||provider?.logo_url)&&!uploading&&<div className="flex items-center gap-3"><img src={logo||provider.logo_url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-brand-line"/><p className="helper text-sm">{logo?'New image ready — it is saved when you click the button below.':'Current image. Choose a file above to replace it.'}</p>{logo
  ? <button type="button" className="text-sm underline" onClick={()=>{setLogo('');forgetUpload()}}>Remove</button>
  : <button type="button" className="text-sm underline" onClick={()=>{setLogo(null);forgetUpload()}}>Remove</button>}</div>}</div><GalleryEditor value={data.gallery} ownerEdit={ownerEdit} onChange={g=>setData(d=>({...d,gallery:typeof g==='function'?g(d.gallery):g}))} onUploading={galleryBusy}/>{!provider&&<label className="flex items-start gap-3 rounded-lg border border-brand-line p-4"><input type="checkbox" className="mt-1" checked={mine} onChange={e=>setMine(e.target.checked)}/><span><span className="block font-semibold text-brand-ink">This is my business</span><span className="block text-sm text-brand-body">Only the owner can edit a listing. Tick this and we will check with you before handing it over, so you can keep it up to date.</span></span></label>}{err&&<p className="text-sm font-semibold text-brand-error">{err}</p>}<button disabled={busy} className="primary w-full sm:w-auto disabled:opacity-60">{busy?(provider?'Saving…':'Publishing…'):(provider?'Save changes':'Publish my listing')}</button></form>}
function Field({label,...props}){return <label>{label}<input className="field" {...props}/></label>}

// Up to three photos, each credited to the business's own site or page —
// unless the listing's owner is the one saving (ownerEdit), whose own pictures
// need no credit, or the photo is one the owner put up (from_owner), which
// staff can keep without crediting. The server applies the same rule. The
// caption and source are asked for next to the picture rather than in a
// separate step, because a photo without them is refused by the server and the
// person should see why before they press Save. Uploading happens the moment a
// file is picked, the same way the logo does, so the Save button only ever
// sends URLs.
//
// onUploading tells the form when a photo is in flight, so Save can wait for
// it; the form owns the Save button and cannot otherwise see in here. onChange
// may be handed a function of the current list, because the upload awaits and
// the `value` this closure captured is stale by the time it resolves — a photo
// removed during the upload used to come back when the upload landed.
export function GalleryEditor({ value = [], ownerEdit = false, onChange, onUploading }){
  const [err,setErr]=useState('');
  const [uploading,setUploading]=useState(false);
  const set=(i,patch)=>onChange(value.map((g,j)=>j===i?{...g,...patch}:g));
  const remove=(i)=>onChange(value.filter((_,j)=>j!==i));
  const busy=(on)=>{ setUploading(on); onUploading?.(on); };
  const add=async e=>{
    const file=e.target.files?.[0]; e.target.value='';
    if(!file||value.length>=GALLERY_MAX)return;
    busy(true);setErr('');
    try{ const {file_url}=await api.integrations.Core.UploadFile({file}); if(!file_url) throw new Error('The image was not saved. Please try again.'); onChange(cur=>(cur||[]).length>=GALLERY_MAX?cur:[...(cur||[]),{url:file_url,caption:'',source_url:''}]); }
    catch(error){ setErr(error.message||'Could not upload that image'); }
    finally{ busy(false); }
  };
  return <fieldset className="rounded-lg border border-brand-line p-4">
    <legend className="px-1 text-sm font-semibold text-brand-ink">{ownerEdit?`Photos (up to ${GALLERY_MAX})`:`Photos (up to ${GALLERY_MAX}, official sources only)`}</legend>
    <p className="helper mt-0">{ownerEdit?'These are your own photos, so a credit and source link are optional. Without a credit, the page says "Photo from the business."':'Only pictures the business itself has published.'}</p>
    {value.length>0&&<ul className="mt-3 space-y-4">{value.map((g,i)=>{const free=ownerEdit||g.from_owner;return <li key={g.url+i} className="grid gap-3 sm:grid-cols-[96px_minmax(0,1fr)]">
      <img src={g.url} alt={g.caption||`Photo ${i+1}`} className="h-24 w-24 rounded-lg border border-brand-line object-cover"/>
      <div className="grid gap-2">
        {!ownerEdit&&g.from_owner&&<p className="helper m-0 text-sm">Added by the business owner, so no credit is needed.</p>}
        <Field label={free?'Credit (optional)':'Credit (shown under the photo)'} value={g.caption} onChange={e=>set(i,{caption:e.target.value})} placeholder="Photo: example.org" maxLength={200} required={!free}/>
        <Field label={free?'Source link (optional)':'Official source link'} type="url" value={g.source_url} onChange={e=>set(i,{source_url:e.target.value})} placeholder="https://" required={!free}/>
        <button type="button" onClick={()=>remove(i)} className="justify-self-start text-sm font-semibold text-brand-error underline">Remove photo</button>
      </div>
    </li>;})}</ul>}
    {value.length<GALLERY_MAX&&<label className="mt-3 block text-sm">Add a photo<input type="file" accept="image/*" onChange={add} disabled={uploading} className="field"/></label>}
    {uploading&&<p className="helper">Uploading…</p>}
    {err&&<p className="text-sm font-semibold text-brand-error">{err}</p>}
  </fieldset>;
}

// Meat, dairy, fish, pareve, or both. One pick, shown as a pill on the listing
// page; "Not set" takes it down.
function KitchenPicker({ value = '', onChange }){
  const opt=(id,label,hint)=><label key={id||'none'} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${value===id?'border-brand-teal bg-brand-tint':'border-brand-line'}`}><input type="radio" name="kitchen" className="mt-1" checked={value===id} onChange={()=>onChange(id)}/><span><span className="font-medium text-brand-ink">{label}</span>{hint&&<span className="block text-xs text-brand-muted">{hint}</span>}</span></label>;
  return <fieldset className="rounded-lg border border-brand-line p-4">
    <legend className="px-1 text-sm font-semibold text-brand-ink">Meat, dairy or fish</legend>
    <p className="helper mt-0">What kind of kitchen is it? This shows as a label on the listing page.</p>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{KITCHENS.map(k=>opt(k.id,k.label,k.hint))}{opt('','Not set','')}</div>
  </fieldset>;
}

// Only the badges this kind of business can honestly claim. Changing the
// category re-offers the list and drops anything that no longer applies, so a
// listing cannot keep a badge from a trade it left.
export function BadgePicker({ category, value = [], onChange }){
  const { specific, universal, all } = badgesForCategory(category);
  useEffect(()=>{
    const allowed = new Set(all.map(b=>b.id));
    const kept = value.filter(id=>allowed.has(id));
    if(kept.length!==value.length) onChange(kept);
  },[category]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle=(id,on)=>onChange(on?[...value,id]:value.filter(x=>x!==id));
  const Row=({b})=><label className="flex items-start gap-2 text-sm text-brand-body"><input type="checkbox" className="mt-1" checked={value.includes(b.id)} onChange={e=>toggle(b.id,e.target.checked)}/><span><span className="font-medium text-brand-ink">{b.label}</span>{b.hint&&<span className="block text-xs text-brand-muted">{b.hint}</span>}</span></label>;
  return <fieldset className="rounded-lg border border-brand-line p-4">
    <legend className="px-1 text-sm font-semibold text-brand-ink">Community badges</legend>
    {!category
      ? <p className="helper mt-0">Choose a category above and the badges for that kind of business appear here.</p>
      : <>
        <p className="helper mt-0">Tick what applies to {category.toLowerCase()}. Claims like Shomer Shabbos or kashrus read as self-declared.</p>
        {specific.length>0&&<div className="mt-3 grid gap-2 sm:grid-cols-2">{specific.map(b=><Row key={b.id} b={b}/>)}</div>}
        {universal.length>0&&<><p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-muted">Any listing</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{universal.map(b=><Row key={b.id} b={b}/>)}</div></>}
      </>}
  </fieldset>;
}

// Every country, the US first since most listings are there. The Country
// filter on the search pages lists only the ones with listings.
function CountryField({ value, onChange, required }) {
  return <select className="field" value={value || ''} onChange={(e) => onChange(e.target.value)} required={required}>
    <option value="">Choose a country</option>
    {value && !COUNTRIES.some(([, name]) => name === value) && <option value={value}>{value}</option>}
    <option value={US}>{US}</option>
    {COUNTRIES.filter(([, name]) => name !== US).map(([code, name]) => <option key={code} value={name}>{name}</option>)}
  </select>;
}
