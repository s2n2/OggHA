'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname,'../custom_components/ogg/frontend/ogg-control-deck-card.js'),'utf8');
let Card;
vm.runInNewContext(code, {
  HTMLElement: class {},
  customElements: {get:()=>undefined, define:(_id,cls)=>{Card=cls;}},
  window:{customCards:[]},
  document:{visibilityState:'visible'},
  performance:{now:()=>1000},
  setInterval:()=>9,clearInterval:()=>{},
});
const card=Object.create(Card.prototype);
const deviceEntities=[
  {device_id:'ogg-1',platform:'ogg',entity_id:'binary_sensor.ogg_bond_connected',unique_id:'config:bond:connected'},
  {device_id:'ogg-1',platform:'ogg',entity_id:'button.ogg_bond_pulse',unique_id:'config:bond:pulse'},
  {device_id:'ogg-1',platform:'ogg',entity_id:'switch.ogg_bond_run',unique_id:'config:bond:run'},
  {device_id:'ogg-2',platform:'ogg',entity_id:'binary_sensor.ogg_ditto_connected',unique_id:'config:ditto:connected'},
  {device_id:'ogg-2',platform:'ogg',entity_id:'button.ogg_ditto_pulse',unique_id:'config:ditto:pulse'},
  {device_id:'ogg-2',platform:'ogg',entity_id:'switch.ogg_ditto_run',unique_id:'config:ditto:run'},
  {device_id:'inti-1',platform:'intiha',entity_id:'sensor.intiha_bond_device_reported_intensity',unique_id:'abc_AA:BB:CC:DD:EE:FF_reported_intensity'},
  {device_id:'inti-2',platform:'intiha',entity_id:'sensor.intiha_second_reported_intensity',unique_id:'abc_11:22:33:44:55:66_reported_intensity'},
];
card._registryEntities=deviceEntities;
card._registryDevices=[{id:'ogg-1',name:'Bond'}, {id:'ogg-2',name:'Ditto'}, {id:'inti-1',name:'Bond'}, {id:'inti-2',name:'Other Device'}];
card._autoCache=null;
let data=card._autoEntities();
assert.equal(data.devices.length,2);
assert.equal(data.devices.find(v=>v.name==='Bond').reported_intensity,'sensor.intiha_bond_device_reported_intensity');
assert.equal(data.devices.find(v=>v.name==='Ditto').reported_intensity,undefined);
card._config={reported_intensity_entities:{Ditto:'sensor.intiha_second_reported_intensity'}};
assert.equal(card._resolve().devices.find(v=>v.name==='Ditto').reported_intensity,'sensor.intiha_second_reported_intensity');
// A duplicate name must never be guessed.
card._registryEntities=[...deviceEntities,{device_id:'inti-3',platform:'intiha',entity_id:'sensor.intiha_duplicate_reported_intensity',unique_id:'abc_77:88:99:00:11:22_reported_intensity'}];
card._registryDevices.push({id:'inti-3',name:'Bond'});
card._autoCache=null;
assert.equal(card._autoEntities().devices.find(v=>v.name==='Bond').reported_intensity,undefined);
assert.equal(card._nameKey('We-Vibe'), '');
// Report absent: bright line is blank; target graph continues.
let paths={};
const el=(k)=>({setAttribute:(a,v)=>{paths[k+':'+a]=v},style:{opacity:''}});
const view={spark:{points:[0,20,30,60],actualPoints:[null,20,null,60],active:true},refs:{'spark-line':el('target'),'spark-fill':el('fill'),'spark-actual':el('actual'),'spark-dot':el('dot')}};
card._paintSpark(view);
assert.match(paths['target:d'],/^M/);
assert.match(paths['actual:d'],/^M/);
assert.equal((paths['actual:d'].match(/M/g)||[]).length,2,'Do not interpolate across missing readings');
view.spark.actualPoints=[null,null,null,null];
card._paintSpark(view);
assert.equal(paths['actual:d'],'');
// Final zero must remain a genuine zero, not be mistaken for missing feedback.
view.spark.actualPoints=[50,50,25,0];
card._paintSpark(view);
assert.match(paths['actual:d'],/27\.00$/);
console.log('Dual-wave frontend tests passed: matching, alias override, ambiguity, telemetry gaps, zero.');
