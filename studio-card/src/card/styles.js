// Part of the OggStudio card. Built into custom_components/ogg/frontend/oggstudio-card.js (npm run build).

export const STYLES = `
:host{--ink:#e8edff;--muted:#8f9ab8;--line:rgba(174,194,246,.16)}
ha-card{background:#0a1122;color:var(--ink);border-radius:22px;border:1px solid #293552;padding:16px;font-family:inherit;display:flex;flex-direction:column}
.toast{order:99}
h2{margin:0 0 2px;font-size:20px;letter-spacing:-.02em} .sub{color:var(--muted);font-size:12px;margin-bottom:12px}
section{border:1px solid var(--line);border-radius:16px;padding:12px;margin-top:10px;background:rgba(255,255,255,.035)}
h3{margin:0 0 8px;font-size:13px;color:#cdd6f6;letter-spacing:.01em}
label{display:block;font-size:11px;color:var(--muted);margin:6px 0 3px}
select,input[type=text],input[type=password],textarea{width:100%;box-sizing:border-box;background:#18233d;color:var(--ink);border:1px solid #33415f;border-radius:10px;padding:8px;font:inherit;font-size:13px}
textarea{min-height:60px;resize:vertical;font-family:monospace;font-size:11px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap} .row > *{flex:1}
button{border:1px solid rgba(118,200,239,.35);background:#24395a;color:#bef2ff;border-radius:12px;min-height:44px;padding:0 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
button:disabled{opacity:.4;cursor:default}
button.rec{width:100%;min-height:56px;font-size:16px;background:#5a2433;border-color:rgba(255,110,130,.5);color:#ffd2da}
button.rec.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710}
button.stop{background:rgba(246,104,121,.08);border-color:rgba(246,104,121,.3);color:#e9adb7}
.pads{display:grid;grid-template-columns:1fr;gap:10px;margin:4px 0 10px}
.pads.dual{grid-template-columns:1fr 1fr}
.pad{position:relative;height:240px;border-radius:18px;border:1px solid #33415f;background:#141d33;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:ns-resize;outline:none}
.pad:focus-visible{box-shadow:0 0 0 3px rgba(103,224,200,.45)}
.pad .fill{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(0deg,#2fbfa9,#67e0c8);transition:height .05s linear}
.pad.active{border-color:#67e0c8}
.pad .lab{position:absolute;top:10px;left:12px;font-size:12px;font-weight:700;color:#cdd6f6;mix-blend-mode:difference}
.pad .pct{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.55)}
.pad .ticks{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 calc(25% - 1px),rgba(255,255,255,.07) calc(25% - 1px) 25%);pointer-events:none}
input[type=range]{width:100%;accent-color:#67e0c8;height:28px}
.val{font-variant-numeric:tabular-nums;text-align:right;color:#cdd6f6;font-size:12px}
.take{font-size:12px;color:#cdd6f6;margin-bottom:6px}
.hint{font-size:11px;color:var(--muted);margin-top:6px}
.toast{min-height:16px;font-size:12px;color:#ffcf8a;margin-top:8px}
.check{display:flex;gap:8px;align-items:center;font-size:13px;color:#cdd6f6;flex:0 0 auto;min-height:36px}
.check input{width:20px;height:20px;accent-color:#67e0c8}
video{width:100%;max-height:60vh;border-radius:12px;background:#000;margin-top:8px;display:block}
input[type=file]{width:100%;font-size:12px;color:var(--muted)}
button.go{width:100%;min-height:52px;font-size:16px;background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
.vrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
.vstat{font-size:12px;color:#cdd6f6;font-variant-numeric:tabular-nums;margin-top:6px;min-height:16px}
.meter{height:6px;border-radius:3px;background:#18233d;overflow:hidden;margin-top:4px}
.meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2fbfa9,#67e0c8);transition:width .1s linear}
.meter.m2 i{background:linear-gradient(90deg,#8f7dff,#b49cff)}
.hbar{position:relative;height:48px;margin-top:8px;border-radius:12px;border:1px solid #33415f;background:#141d33;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:ew-resize;outline:none}
.hbar .fill{position:absolute;top:0;bottom:0;left:0;width:0;background:linear-gradient(90deg,rgba(47,191,169,.55),rgba(103,224,200,.85))}
.hbar.m2 .fill{background:linear-gradient(90deg,rgba(143,125,255,.55),rgba(180,156,255,.85))}
.hbar.active{border-color:#67e0c8}
.hbar.rec{border-color:rgba(255,110,130,.55)}
.hbar .lab{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:700;color:#e8edff;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.hbar .pct{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6)}
.vrecrow{display:flex;gap:8px;align-items:center;margin-top:8px}
.vrecrow .check{min-height:40px;font-size:12px}
button.vrec{flex:0 0 auto;min-height:40px;padding:0 14px;background:#5a2433;border-color:rgba(255,110,130,.5);color:#ffd2da}
button.vrec.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710}
.vrecinfo{flex:1;text-align:right;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.gp{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:0 1 auto}
.gp.on{flex:1 1 100%;margin-top:4px;padding:4px 10px 8px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025)}
.gp .check{min-height:36px;font-size:13px}
.gpmore{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1 1 100%}
.gpslot{display:contents}
.stlive{display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;margin-top:6px}
.gp .gpstat{flex:1;min-width:140px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.gp .gpstat b{color:#bef2ff}
.gp button{min-height:36px;flex:0 0 auto}
.gplearn{flex-basis:100%;font-size:13px;color:#ffcf8a;font-weight:700}
.gpraw{flex-basis:100%;font-size:10.5px;color:var(--muted);font-family:monospace;word-break:break-all}
.st{display:grid;grid-template-columns:minmax(150px,52%) 1fr;gap:10px;margin:4px 0 10px}
.sttrack{display:grid;grid-template-columns:44% 1fr;gap:6px;height:256px}
.strail,.stlane{position:relative;border-radius:16px;border:1px solid #33415f;background:#141d33;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:ns-resize;outline:none}
.strail.active,.stlane.active{border-color:#67e0c8}
.strail:focus-visible,.stlane:focus-visible{box-shadow:0 0 0 3px rgba(103,224,200,.45)}
.sttrack .ticks{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 calc(25% - 1px),rgba(255,255,255,.07) calc(25% - 1px) 25%);pointer-events:none}
.stband{position:absolute;left:6px;right:6px;border-radius:10px;background:rgba(103,224,200,.22);box-sizing:border-box;pointer-events:none}
.stband::before,.stband::after{content:'';position:absolute;left:18%;right:18%;height:6px;border-radius:3px;background:#67e0c8}
.stband::before{top:-3px} .stband::after{bottom:-3px}
.stband .grip{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:14px;color:rgba(103,224,200,.85)}
.stshade{position:absolute;left:0;right:0;background:rgba(103,224,200,.08);border-top:1px dashed rgba(103,224,200,.45);border-bottom:1px dashed rgba(103,224,200,.45);box-sizing:border-box;pointer-events:none}
.sttags{display:grid;grid-template-columns:44% 1fr;gap:6px;margin-bottom:4px;font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.05em;text-align:center}
.stpos{position:absolute;left:8%;right:8%;height:14px;margin-bottom:-7px;border-radius:7px;background:linear-gradient(90deg,#ff8aa0,#ffcf8a);box-shadow:0 0 12px rgba(255,138,160,.6)}
.stlim{position:absolute;left:0;right:0;text-align:center;font-size:11px;font-weight:800;color:#bff5ea;font-variant-numeric:tabular-nums;pointer-events:none}
.stlane .pct{position:absolute;top:8px;left:0;right:0;text-align:center;font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.55);pointer-events:none}
.stside{display:flex;flex-direction:column;gap:8px}
.stspd{flex:1;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:4px 6px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.025)}
.stside button.sthold{min-height:40px;font-size:14px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.stside button.sthold.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
.stctl{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.stsl{display:flex;align-items:center;gap:6px}
.stsl input{flex:1;min-width:0;height:24px;margin:0}
.stsl b{flex:0 0 42px;text-align:right;font-size:12.5px;color:#bef2ff;font-variant-numeric:tabular-nums}
.st{position:relative}
.ctltabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.ctltabs button{flex:1 1 auto;padding:0 12px;white-space:nowrap}
.ctltabs button.live:not(.on){box-shadow:inset 0 0 0 2px #67e0c8}
.head{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.head h2{flex:1;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.head button{flex:0 0 auto;min-height:36px;padding:0 12px;font-size:13px}
ha-card.locked > :not(#cover){display:none!important}
.cover{display:flex;flex-direction:column;gap:10px;padding:8px 0}
.cover[hidden]{display:none}
.cover .stop{align-self:flex-start;min-height:36px;padding:0 12px;font-size:13px}
.subbox{margin-top:8px;padding:10px;border-radius:14px;border:1px solid #293552;background:#0e1730}
.subbox .row{margin-top:6px}
.subbox .row:first-child{margin-top:0}
.limbtn{margin-top:8px;min-height:36px;font-size:13px;width:100%}
.limdev h4{margin:8px 0 0;font-size:13px;color:#bef2ff}
.limdev:first-child h4{margin-top:0}
.limdev label b{color:#bef2ff}
.limdev input{width:100%}
.rpbar canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:none;image-rendering:pixelated}
.rpbar.heat canvas{display:block}
.rpbar.heat i{background:rgba(255,255,255,.3);border-right:2px solid #fff}
.rppop button{flex-wrap:wrap}
.pkheat{flex:0 0 100%;width:100%;height:5px;border-radius:3px;margin:2px 0 4px;image-rendering:pixelated}
.plitem{display:flex;gap:6px;margin-bottom:6px}
.plitem button{flex:0 0 40px;min-height:40px;padding:0}
.plitem .plname{flex:1;text-align:left;padding:0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#18233d}
.plitem.on .plname{box-shadow:inset 0 0 0 2px #67e0c8}
#plbtn.on{box-shadow:inset 0 0 0 2px #67e0c8}
#auel{width:100%;margin-top:6px}
#tgsend,#tgshare,#tglink{width:100%}
.moodgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px}
.moodgrid button.moodbtn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:60px;padding:4px;font-size:12px;background:#18233d}
.moodgrid button.moodbtn span{font-size:20px;line-height:1}
.moodgrid button.moodbtn.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710;border-color:transparent}
.moodrow{display:flex;align-items:center;gap:8px;margin-top:6px}
.moodrow label{margin:0;flex:0 0 auto}
.moodrow input{flex:1}
.moodrow b{flex:0 0 44px;text-align:right;font-size:12.5px;color:#bef2ff}
.ctltabs button{min-height:44px;font-size:14.5px;background:#24395a;color:#bef2ff}
.ctltabs button.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
.rpbox{position:relative}
button.rppick{width:100%;text-align:left;background:#18233d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rppop{position:absolute;z-index:6;left:0;right:0;top:48px;max-height:300px;overflow:auto;padding:6px;border-radius:14px;border:1px solid #67e0c8;background:#101a30;box-shadow:0 10px 30px rgba(0,0,0,.6)}
.rppop button{display:flex;justify-content:space-between;width:100%;min-height:40px;margin:2px 0;background:#18233d;text-align:left}
.rppop button small{color:var(--muted);font-weight:600}
.rppop .rpfile{display:block;margin:6px 2px 2px;font-size:12px;color:#cdd6f6}
.rpbar{position:relative;height:14px;margin-top:8px;border-radius:7px;background:#18233d;overflow:hidden;cursor:pointer;touch-action:none}
.rpbar i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2fbfa9,#67e0c8)}
.rpinfo{font-size:12px;color:#cdd6f6;font-variant-numeric:tabular-nums;margin-top:4px;text-align:center;min-height:16px}
.rprow{display:grid;grid-template-columns:1fr 84px auto;gap:8px;align-items:center;margin-top:6px}
.rprow select{min-height:44px}
#outhome{padding:0;border:0;background:none}
.outbox{margin-top:0;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025)}
.outbox > label{margin-top:0}
.outrow{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;align-items:center}
.outrow.solo{grid-template-columns:1fr}
.outrow.solo.take{grid-template-columns:1fr auto}
.outrow button.outtake{min-height:38px;background:rgba(255,207,138,.12);border-color:rgba(255,207,138,.45);color:#ffcf8a}
.outai{grid-column:1/-1;font-size:11.5px;color:#ffcf8a;font-weight:700;margin:-2px 2px 0}
.outnote{font-size:11px;color:var(--muted);margin-top:4px}
.stside button.stlatch{min-height:40px;padding:0 6px;font-size:11.5px;border-radius:9px;background:#141d33;color:var(--muted)}
.stside button.stlatch.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710;border-color:transparent}
.stside .row button{min-height:46px}
.stinfo{font-size:12px;color:#cdd6f6;font-variant-numeric:tabular-nums;margin-top:6px;text-align:center}
.rechead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.rechead h3{margin:0}
.kind{display:flex;border:1px solid #33415f;border-radius:12px;overflow:hidden;flex:0 0 auto}
.kind button{border:0;border-radius:0;min-height:38px;padding:0 14px;background:#141d33;color:var(--muted)}
.kind button.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24}
ha-card.tg #gp,ha-card.tg .ctltabs{display:none}
ha-card.simple section .rechead,ha-card.simple .vhide,ha-card.simple #rptools{display:none}
ha-card:not(.simple) .vside,ha-card:not(.simple) .vshow,ha-card.simple .vfold:not(.open){display:none}
ha-card.simple #ctlbox{padding:10px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.035)}
ha-card.simple .ctltabs{flex-wrap:nowrap;gap:4px}
ha-card.simple .ctltabs button{flex:1 1 0;min-width:0;padding:2px 2px;font-size:12px;line-height:1.2;white-space:normal}
#urecrow{margin-top:8px}
.urechead{display:flex;gap:8px;align-items:stretch}
.urechead button.rec{flex:1;width:auto}
.urechead .kind button{min-height:56px;padding:0 10px}
#utimer{text-align:center;margin-top:4px;min-height:0}
#utimer:empty{display:none}
#takebox.busy>:not(h3):not(.take){display:none}
#takebox.busy .take{color:#ffd2da;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;margin:0}
.ptgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px;margin-top:8px}
.ptgrid button.ptbtn{min-height:40px;padding:0 4px;background:#18233d}
.ptgrid button.ptbtn.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710;border-color:transparent}
#ptbox .moodrow label{flex:0 0 64px}
.vwrap{display:flex;gap:8px;align-items:stretch}
.vstage{flex:1;min-width:0}
.hbar.vert{cursor:ns-resize}
.vstage{position:relative}
.vstage.full{display:flex;align-items:center;justify-content:center;background:#000;width:100%;height:100%}
.vstage.full video{width:100%;height:100%;max-height:none!important;margin:0;object-fit:contain;border-radius:0}
.hbar.ovl{position:absolute;left:max(6px,env(safe-area-inset-left));top:12%;bottom:20%;width:56px;height:auto;margin:0;z-index:2;background:transparent;border:0;border-radius:0;overflow:visible;opacity:.75;transition:opacity .2s}
.hbar.ovl.active{opacity:1}
.hbar.ovl .fill,.hbar.ovl .lab,.hbar.ovl .pct{display:none}
.hbar.ovl::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(255,255,255,.35);box-shadow:0 0 2px rgba(0,0,0,.6)}
.hbar.ovl::after{content:'';position:absolute;left:50%;bottom:calc(var(--v,0) * 1%);width:18px;height:18px;margin:0 0 -9px -9px;border-radius:50%;background:#67e0c8;box-shadow:0 0 0 2px rgba(0,0,0,.45)}
.hbar.ovl.active::after{background:#fff}
.hbar.vert .fill{top:auto;right:0;bottom:0;width:auto!important;height:0;background:linear-gradient(0deg,rgba(47,191,169,.55),rgba(103,224,200,.85))}
.hbar.vert .lab{left:50%;top:10px;transform:translateX(-50%);writing-mode:vertical-rl;font-size:10.5px}
.hbar.vert .pct{right:auto;left:50%;top:auto;bottom:8px;transform:translateX(-50%);font-size:13px}
.vside{display:flex;gap:6px;margin-top:8px}
.vside button{flex:1 1 0;min-height:40px;padding:0;font-size:18px;background:#18233d}
.vside button.has{border-color:#67e0c8}
.vside button.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);border-color:transparent}
.vside button:disabled{opacity:.4}
button.vempty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;min-height:294px;margin-top:8px;border:2px dashed #33415f;background:#0e1730;font-size:15px}
button.vempty small{font-weight:600;color:var(--muted);font-size:11.5px;padding:0 12px}
ha-card.simple video{max-height:78vh}
ha-card.simple #videobox{padding:8px}
#aubox.fromvideo #ausrcbox,#aubox.fromvideo #aufilebox,#aubox.fromvideo #augo{display:none!important}
#aubox.fromvideo{margin-top:8px;padding:10px;border-radius:14px;border:1px solid #293552;background:#0e1730}
#aubox.fromvideo>label:first-of-type{margin-top:0}
:host{font-family:var(--primary-font-family,Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif);color-scheme:dark;--line:rgba(174,194,246,.13);--muted:#9aa7c4;--ink:#f5f6ff}
ha-card{border-radius:26px;padding:20px;box-shadow:0 20px 55px rgba(0,0,0,.22);background:radial-gradient(circle at calc(100% + 60px) -60px,rgba(105,100,240,.24),transparent 230px),radial-gradient(circle at -40px 300px,rgba(44,199,191,.09),transparent 220px),#0a1122}
.head{gap:12px;margin-bottom:4px;align-items:center}
.brand{flex:none;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:15px;background:linear-gradient(155deg,#6adfd4,#667ee8);box-shadow:0 8px 25px rgba(74,169,210,.2);color:#091929}
.brand svg{width:24px;height:24px}
.htext{flex:1;min-width:0}
.eyebrow{font-size:10px;font-weight:850;letter-spacing:.19em;color:#9ce2d9;text-transform:uppercase;margin-bottom:2px}
.head h2{font-size:22px;letter-spacing:-.045em;line-height:1.07;font-weight:750;color:#f6f8ff}
.head button.stop{min-height:34px;padding:0 12px;border-radius:30px;font-size:11.5px;font-weight:780;color:#ffbcc2;background:rgba(244,100,118,.09);border-color:rgba(239,115,134,.26)}
.sub{font-size:12px;color:var(--muted);margin:2px 0 14px 56px;line-height:1.35}
section{border:1px solid var(--line);border-radius:19px;padding:14px;background:linear-gradient(145deg,rgba(255,255,255,.056),rgba(255,255,255,.025))}
h3{font-size:14px;letter-spacing:-.01em;color:#e8edff;font-weight:760}
label{font-size:10.5px;font-weight:620;color:#99a9c5;letter-spacing:.01em;margin:8px 3px 5px}
select{appearance:none;-webkit-appearance:none;min-height:40px;border-radius:12px;background:#17233c url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a6b5d7' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center/13px;border:1px solid #364563;color:#fff;font-weight:650;padding:8px 30px 8px 11px}
button{border-radius:13px;font-weight:760;background:#24395a;border-color:rgba(118,200,239,.35);color:#bef2ff;transition:transform .12s ease,filter .15s ease}
button:active:not(:disabled){transform:scale(.98)}
button.go{border:0;border-radius:15px;color:#081b23;background:linear-gradient(115deg,#80f3d7,#7bccfa);box-shadow:0 5px 23px rgba(66,223,214,.14)}
button.stop{color:#ffbcc2;background:rgba(244,100,118,.09);border-color:rgba(239,115,134,.26)}
button.rec{border-radius:15px;min-height:54px;font-size:15px;font-weight:780;color:#ffc9d1;background:rgba(244,100,118,.14);border:1px solid rgba(239,115,134,.38)}
button.rec.on{border-color:transparent;color:#2a0710;background:linear-gradient(115deg,#ff8aa0,#ffb38a);box-shadow:0 5px 23px rgba(255,120,140,.2)}
input[type=checkbox]{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:40px;height:24px;margin:0;border-radius:99px;border:1px solid #505e76;background:#2a3550;cursor:pointer;transition:.18s ease}
input[type=checkbox]::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#d4daed;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s ease,background .18s ease}
input[type=checkbox]:checked{background:linear-gradient(110deg,#31c6b8,#54d4bc);border-color:transparent}
input[type=checkbox]:checked::after{transform:translateX(16px);background:#072a2d}
.check{font-size:12px;font-weight:650;color:#d2dcf3;gap:9px}
.pad,.strail,.stlane{border-radius:19px;border-color:#364563;background:#17243e}
.pad .fill{background:linear-gradient(0deg,#31c6b8,#7bccfa)}
.outbox{padding:10px 12px;border-radius:19px;background:rgba(255,255,255,.045)}
ha-card.simple #ctlbox{padding:12px;border-radius:21px;border:1px solid rgba(142,123,250,.24);background:linear-gradient(125deg,rgba(112,95,217,.16),rgba(42,136,157,.065));margin-top:10px}
.ctltabs button,ha-card.simple .ctltabs button{min-height:42px;border-radius:13px;background:rgba(255,255,255,.045);border:1px solid rgba(143,163,200,.2);color:#c5d2f0;font-weight:760}
.ctltabs button.on{background:linear-gradient(110deg,#31c6b8,#54d4bc);color:#072a2d;border-color:transparent}
.lsw{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;margin:0;padding:6px 10px;border-radius:15px;border:1px solid #364563;background:#17243e;color:#d2dcf3;font-size:11px;font-weight:720;cursor:pointer}
ha-card.simple #liverow,ha-card.simple #stliverow{display:none!important}
.ptgrid button.ptbtn,.moodgrid button.moodbtn{background:rgba(255,255,255,.045);border-color:rgba(143,163,200,.2);color:#d2dcf3}
.ptgrid button.ptbtn.on,.moodgrid button.moodbtn.on{background:linear-gradient(110deg,#8f7dff,#b49cff);color:#140c3a;border-color:transparent}
.vside button{border-radius:12px;background:rgba(255,255,255,.045);border-color:rgba(143,163,200,.2)}
.vside button.on{background:linear-gradient(110deg,#31c6b8,#54d4bc)}
.toast{color:#ffcf8a}
/* Video controls: a slim line on each side of the video, faint while it plays */
.vst{position:absolute;inset:0;pointer-events:none;z-index:2;opacity:.85;transition:opacity .6s}
.vst.idle{opacity:.28}
.vstspd{position:absolute;left:max(4px,env(safe-area-inset-left));top:8%;bottom:24%;width:40px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:auto}
.vstspd b{font-size:9.5px;font-weight:700;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.9);white-space:nowrap}
.vstline{position:relative;flex:1;width:40px;touch-action:none;cursor:ns-resize}
.vstline::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.3);box-shadow:0 0 2px rgba(0,0,0,.6)}
.vstline .dot{position:absolute;left:50%;width:12px;height:12px;margin:0 0 -6px -6px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 1px rgba(0,0,0,.45)}
.vstline.active .dot{width:18px;height:18px;margin:0 0 -9px -9px;background:#fff}
.vstline.dim .dot{background:rgba(255,255,255,.45)}
.vstspd button{min-height:24px;width:30px;padding:0;font-size:12px;border-radius:9px;color:rgba(255,255,255,.85);background:rgba(0,0,0,.3);border-color:rgba(255,255,255,.25)}
.vstspd button.on{background:rgba(255,255,255,.35);color:#fff;border-color:rgba(255,255,255,.5)}
.vstrail{position:absolute;right:max(2px,env(safe-area-inset-right));top:calc(8% - 22px);bottom:calc(24% - 22px);width:40px;pointer-events:auto;touch-action:none;cursor:ns-resize}
.vstrail .trk{position:absolute;left:0;right:0;top:22px;bottom:22px;pointer-events:none}
.vstrail .trk::before{content:'';position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.3);box-shadow:0 0 2px rgba(0,0,0,.6)}
.vstrail .band{position:absolute;left:50%;width:6px;margin-left:-3px;border-radius:3px;background:rgba(255,255,255,.28);box-shadow:0 0 2px rgba(0,0,0,.5)}
.vstrail .h{position:absolute;left:50%;width:14px;height:4px;margin-left:-7px;border-radius:2px;background:rgba(255,255,255,.7);color:transparent;font-size:0;box-shadow:0 0 2px rgba(0,0,0,.6)}
.vstrail .hu{top:-2px}
.vstrail .hl{bottom:-2px}
.vstrail.active .band{background:rgba(255,255,255,.4)}
.vstrail.active .h{width:26px;height:14px;margin-left:-13px;border-radius:4px;background:rgba(255,255,255,.85);color:#111;font-size:9px;font-weight:800;line-height:14px;text-align:center}
.vstrail.active .hu{top:-7px}
.vstrail.active .hl{bottom:-7px}
.vstrail .dot{position:absolute;left:50%;width:10px;height:10px;margin:0 0 -5px -5px;border-radius:50%;background:rgba(255,255,255,.75);box-shadow:0 0 0 1px rgba(0,0,0,.45)}
.urechead{justify-content:space-between;align-items:center}
.urechead .kind{flex:0 1 auto}
.urechead .kind button{min-height:42px;padding:0 12px;font-size:12px}
.urechead button.rec{flex:0 0 auto;width:auto;min-height:42px;padding:0 18px;font-size:13px;border-radius:13px}
ha-card.simple .hbar{margin-top:10px;border-radius:15px;border-color:#364563;background:#17243e}
ha-card.simple .hbar .fill{background:linear-gradient(90deg,rgba(49,198,184,.55),rgba(123,204,250,.75))}
button.outhead{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:0 2px;border:0;background:none;color:#e8edff;text-align:left}
.outhead .outtitle{flex:1;font-size:14px;font-weight:760;letter-spacing:-.01em}
.outcount{display:flex;align-items:center;gap:5px;border:1px solid rgba(100,218,189,.23);background:rgba(40,124,115,.17);padding:6px 10px;border-radius:30px;font-size:11px;font-weight:600;color:#9adbd1;white-space:nowrap}
.outcount i{width:7px;height:7px;border-radius:50%;background:#58d6b2;box-shadow:0 0 0 4px rgba(64,194,164,.11)}
.outcount b{font-weight:800;color:#e7fff9;font-variant-numeric:tabular-nums}
.outcount.zero{border-color:rgba(174,194,246,.14);color:var(--muted);background:rgba(169,184,217,.08)}
.outcount.zero i{background:#72809f;box-shadow:none}
.outhead .chev{font-size:13px;color:#a8b8da;transition:transform .18s ease}
.outbox.folded .chev{transform:rotate(-90deg)}
#outrows{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.outrow{display:grid;grid-template-columns:auto auto minmax(0,1fr) minmax(0,1fr) 34px;gap:6px;margin-top:0;align-items:center}
.outrow.take{grid-template-columns:auto auto minmax(0,1fr) 34px}
.outrow .outpad{display:grid;place-items:center;width:18px;height:18px;border-radius:6px;background:rgba(152,168,249,.16);color:#c5d2f0;font-size:10px;font-weight:800}
.outrow .outpad[hidden]{display:none}
.outrow button.outdel{min-height:34px;width:34px;padding:0;font-size:12px;border-radius:10px;color:#e9adb7;background:rgba(246,104,121,.08);border-color:rgba(246,104,121,.2)}
.outrow .outai,.outrow .outtake{grid-column:3/-1}
.outbtns{display:flex;gap:8px;margin-top:8px}
.outbtns button{flex:1;min-height:38px;margin:0;font-size:12.5px}
.outbtns button[hidden]{display:none}
ha-card.simple #vaubox #aubox{margin-top:10px;padding:12px;border-radius:15px;border:1px solid #364563;background:#17243e}
ha-card.simple #vaubox #aubox>label:first-of-type,ha-card.simple #sndbox #aubox>label:first-of-type{margin-top:0}
#sndbox #aubox{margin:0;padding:0;border:0;background:none}
ha-card.simple button.vempty{min-height:160px}
ha-card.simple .ctltabs button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:50px;line-height:1.1}
ha-card.simple .ctltabs button .ti{font-size:15px;line-height:1}
ha-card.simple .ctltabs button span:last-child{font-size:11.5px;white-space:nowrap}
ha-card:not(.simple) .mhead{display:none}
#videobox.mfold > :not(.mhead){display:none!important}
#sndbox.mfold > :not(.mhead){display:none!important}
.mfold > .mhead .chev{transform:rotate(-90deg)}
#sndbox > .mhead{margin-bottom:2px}
#sndbox #aubox{margin-top:6px}
.mhead .outcount b{max-width:150px;overflow:hidden;text-overflow:ellipsis}
ha-card:not(.simple) #sndbox{display:none}
ha-card.simple section#sndbox{margin-top:10px}
ha-card.cfold #ctlbox > :not(#ctlhead),ha-card.cfold section[data-part="record"],ha-card.cfold section[data-part="stroke"]{display:none!important}
ha-card.cfold #ctlhead .chev{transform:rotate(-90deg)}
#ctlhead{margin-bottom:6px}
ha-card.simple .moodgrid{grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:5px}
ha-card.simple .moodgrid button.moodbtn{flex-direction:row;justify-content:flex-start;gap:6px;min-height:38px;padding:0 9px;font-size:12px;border-radius:11px}
ha-card.simple .moodgrid button.moodbtn span{font-size:15px}
ha-card:not(.simple) #extrabox{display:none}
ha-card.simple section#extrabox{margin-top:10px}
#extrabox.mfold > :not(.mhead){display:none!important}
#extrabox > section{margin-top:10px;padding:0;border:0;background:none}
#extrabox #xgpslot{display:block;margin-top:6px}
#libslot > section{margin-top:8px;padding:0;border:0;background:none}
#libslot > section h3{display:none}
ha-card.simple section[data-part="record"] .hint,ha-card.simple section[data-part="stroke"] .hint,ha-card.simple .hint.vshow{display:none}
#rpbox.lib .rppick,#rpbox.lib .rppop,#rpbox.lib .rprow,#rpbox.lib #rptools,#rpbox.lib .subbox,#rpbox.lib.empty{display:none!important}
#rpbox.lib{order:2;margin-top:8px}
.ptpick{display:grid;grid-template-columns:minmax(0,1fr) 108px;gap:8px;margin-top:8px}
.ptpick select{min-height:46px;font-size:14px}
.ptpick button{min-height:46px}
#libsavebox{margin-top:8px}
ha-card.simple #takebox{display:none!important}
ha-card.simple #ctlbox > section{margin:4px 0 10px;padding:0;border:0;background:none}
#outbody > #ukind{display:flex;margin:6px 0 8px}
#outbody > #ukind button{flex:1;min-height:40px;font-size:12.5px}
.urecslot{align-items:center}
.row.urecslot{flex-wrap:nowrap;gap:10px}
ha-card.simple .row.urecslot > label.check{min-width:0;flex:0 1 auto;white-space:nowrap;overflow:hidden;font-size:12px}
.urecslot .gpslot{display:none}
ha-card.simple .urecslot > label.check{margin-left:auto;flex:0 0 auto;flex-direction:row-reverse}
ha-card.simple .urecslot > button.rec{flex:0 0 auto;width:auto;min-height:42px;padding:0 18px;font-size:13px;border-radius:13px}
ha-card.simple .urecslot > #utimer{flex:0 0 auto;margin:0;text-align:left}
ha-card.simple .stside.urecslot{align-items:stretch}
ha-card.simple .stside.urecslot > button.rec{width:100%}
ha-card.simple .stside.urecslot > #utimer{text-align:center}
ha-card:not(.simple) .psec{display:none}
ha-card.simple section.psec{margin-top:10px}
.psec.mfold > :not(.mhead){display:none!important}
.psec .tsub{margin:10px 0 4px;font-size:12.5px;font-weight:760;color:#e8edff}
#toolsec .subbox,#tgsec #tgbox{margin-top:6px}
#tgsec #tgbox{display:block}
[hidden],.off{display:none!important}
`;
