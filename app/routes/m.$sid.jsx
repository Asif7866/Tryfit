import { validSid, markOpened } from "../lib/handoff.server";

const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TIPS = {
  home: ["Step back and capture the whole bed or wall", "Good daylight, no close-ups"],
  jewelry: ["Face the camera, shoulders up", "Hair back so your neck and ears show"],
  shoes: ["Stand on a plain floor, both feet in frame", "Don't crop at the ankles"],
  fashion: ["Stand tall, head to toe in frame", "Just you, facing the camera"],
};

// Phone page opened from the storefront QR. Uploads one photo to the desktop session.
export const loader = async ({ params }) => {
  const sid = params.sid;
  if (!validSid(sid)) return new Response("Link expired", { status: 400 });
  const m = markOpened(sid) || {};
  const [tip, sub] = TIPS[m.mode] || TIPS.fashion;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>Upload your photo · Wearoom</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
:root{--ink:#1e1c2e;--ink2:#2f2b52;--mute:#8b89a0;--ease:cubic-bezier(.22,1,.36,1)}
html,body{height:100%;background:#faf9f8}
body{font-family:Urbanist,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;padding:20px 18px calc(20px + env(safe-area-inset-bottom))}
.f{width:100%;max-width:400px;padding:1.5px;border-radius:30px;background:linear-gradient(205deg,#e4e2f5,#c9c5ec 48%,#aaa4dc);box-shadow:0 24px 60px -28px rgba(40,30,20,.22)}
.c{background:#fff;border-radius:28.5px;padding:22px 22px 18px;text-align:center}
.h{font-size:12px;font-weight:600;letter-spacing:.3em;padding-left:.3em}
.chip{display:inline-block;margin-top:16px;padding:5px 10px 4px;border-radius:999px;background:#ecebf7;color:#4a4680;font-size:9px;font-weight:700;letter-spacing:.14em}
h1{margin-top:10px;font-size:24px;font-weight:400;letter-spacing:-.015em;line-height:1.2}
.p{display:flex;align-items:center;gap:12px;margin:18px 0 16px;padding:8px;border-radius:16px;background:#f4f3f9;text-align:left}
.p img{width:52px;height:68px;border-radius:10px;object-fit:cover;background:#e9e4dd;flex-shrink:0}
.p b{display:block;font-size:15px;font-weight:600;line-height:1.25}
.p span{font-size:12.5px;color:var(--mute)}
.tip{font-size:14px;line-height:1.45;color:var(--mute);margin-bottom:16px}.tip i{font-style:normal;color:#adabc0}
.btn{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:52px;border-radius:14px;background:var(--ink2);color:#fff;font:500 17px/1 inherit;font-family:inherit;border:none;cursor:pointer;overflow:hidden;transition:transform .3s var(--ease)}
.btn:active{transform:scale(.985)}
.btn input{position:absolute;inset:0;opacity:0;font-size:0}
.ghost{background:transparent;color:var(--ink);height:44px;margin-top:4px;font-size:15px}
.prev{display:none;position:relative;margin:4px auto 16px;width:150px;aspect-ratio:3/4;border-radius:16px;overflow:hidden;background:#f2f0ee}
.prev img{width:100%;height:100%;object-fit:cover}
.prev .sc{position:absolute;inset:0;background:linear-gradient(to bottom,transparent,rgba(255,255,255,.6),transparent);background-size:100% 40%;background-repeat:no-repeat;animation:s 1.6s ease-in-out infinite}
@keyframes s{from{background-position:0 -60%}to{background-position:0 160%}}
.bar{height:6px;border-radius:9px;background:#e3e1f0;overflow:hidden;margin:0 0 10px}.bar i{display:block;height:100%;width:0;background:var(--ink);border-radius:9px;transition:width .3s}
.st{font-size:14px;color:var(--mute)}
.ok{display:none}
.ok .tick{width:64px;height:64px;margin:20px auto 14px;border-radius:50%;background:#4caf72;display:flex;align-items:center;justify-content:center;animation:pop .6s cubic-bezier(.34,1.5,.5,1)}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
.ok h2{font-size:22px;font-weight:500;margin-bottom:6px}.ok p{font-size:14.5px;color:var(--mute);line-height:1.45}
.err{color:#c4453d;font-size:13.5px;margin-top:10px;display:none}
.wm{display:inline-flex;align-items:center;gap:6px;margin-top:14px;font-size:12px;font-weight:500;color:var(--ink);text-decoration:none;opacity:.85}
.wm i{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:6px;background:var(--ink);color:#fff}.wm b{font-weight:700}
</style></head><body><div class="f"><div class="c">
<div class="h">VIRTUAL TRY-ON</div>
<div id="pick">
<span class="chip">STEP 1 OF 2</span><h1>Snap your photo</h1>
${m.t ? `<div class="p">${m.i ? `<img src="${esc(m.i)}" alt="">` : ""}<div><b>${esc(m.t)}</b><span>Your preview will appear on your computer</span></div></div>` : `<p class="tip" style="margin-top:14px">Your preview will appear on your computer</p>`}
<div class="prev" id="prev"><img id="pimg" alt=""><div class="sc"></div></div>
<div id="up" style="display:none"><div class="bar"><i id="bar"></i></div><p class="st" id="st">Sending to your computer…</p></div>
<div id="ctl"><p class="tip">${esc(tip)}<br><i>${esc(sub)}</i></p>
<label class="btn"><input id="cam" type="file" accept="image/*" capture="environment"><svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 4h5.2l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.9zM12 17.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zm0-1.9a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6z"/></svg>Take a photo</label>
<label class="btn ghost"><input id="lib" type="file" accept="image/*"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>Choose from gallery</label></div>
<p class="err" id="err"></p>
</div>
<div class="ok" id="ok"><div class="tick"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h2>All set!</h2><p>Head back to your computer — your look is being styled there.</p></div>
<a class="wm" href="https://apps.shopify.com/tryfit-2" target="_blank" rel="noopener">Powered by <i><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 3.8 4.3 5.7 2.6 10.2l3.1 1.2v8.8h12.6v-8.8l3.1-1.2-1.7-4.5-4.3-1.9c-.5 1.5-1.9 2.5-3.4 2.5s-2.9-1-3.4-2.5z"/></svg></i><b>Wearoom</b></a>
</div></div>
<script>
(function(){
var SID=${JSON.stringify(sid)},$=function(i){return document.getElementById(i)};
function shrink(file){return new Promise(function(res){try{var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var M=1600,w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,M/Math.max(w,h));if(k===1&&file.size<2.5e6){URL.revokeObjectURL(u);return res(file);}var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(function(b){res(b||file)},'image/jpeg',.9)};im.onerror=function(){res(file)};im.src=u;}catch(e){res(file)}})}
function send(file){
  if(!file||!/^image\\//.test(file.type)){return}
  $('err').style.display='none';$('ctl').style.display='none';$('up').style.display='block';
  var pr=$('prev');pr.style.display='block';$('pimg').src=URL.createObjectURL(file);
  fetch('/handoff/'+SID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploading:true})}).catch(function(){});
  shrink(file).then(function(b){
    var fd=new FormData();fd.append('photo',b,'photo.jpg');
    var x=new XMLHttpRequest();x.open('POST','/handoff/'+SID);
    x.upload.onprogress=function(e){if(e.lengthComputable)$('bar').style.width=Math.round(e.loaded/e.total*100)+'%'};
    x.onload=function(){if(x.status>=200&&x.status<300){$('bar').style.width='100%';setTimeout(function(){$('pick').style.display='none';$('ok').style.display='block'},350)}else fail()};
    x.onerror=fail;x.send(fd);
  });
}
function fail(){$('up').style.display='none';$('prev').style.display='none';$('ctl').style.display='block';$('err').textContent='Upload failed — please try again.';$('err').style.display='block'}
$('cam').onchange=function(e){send(e.target.files[0])};$('lib').onchange=function(e){send(e.target.files[0])};
})();
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
};
