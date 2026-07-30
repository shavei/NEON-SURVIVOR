/* NEON SURVIVOR — menu-content.js : the start menu's REFERENCE panels + the difficulty picker.
 * Static player-facing copy (pickups, weapons) plus renderers that generate the merge/boss-reward
 * legends from the live registries, so the menu can never drift from the actual game rules.
 * Loads AFTER ui-engine.js (needs SYNERGIES/Nav/UPGRADES/DIFFS at call time) and BEFORE main.js,
 * whose bootstrap calls renderLegends() + updDiffHint(). Split out of main.js to keep that file
 * under the 28 KB silent-truncation line. Headless-safe: every registry read is typeof-guarded. */

const DHINT={easy:'Relaxed — slower spawns and weaker enemies. Good for learning the ropes.',normal:'Balanced pace and pressure. Recommended for your first real run.',hard:'Brutal — dense swarms, tanky enemies and heavy hits. For veterans.'};
let _dh='balanced — recommended for a first run';   // current hint key (English) — re-translated on lang switch
function updDiffHint(){const el=document.getElementById('diffhint');if(el)el.textContent=tr(_dh);}
document.querySelectorAll('.diff').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.diff').forEach(z=>z.classList.remove('on'));b.classList.add('on');
  DIFF=DIFFS[b.dataset.d];_dh=DHINT[b.dataset.d];updDiffHint();});
/* ===== main-menu content: pickups, weapons, persistent high scores ===== */
const PICKUP_INFO=[
  {ico:'❤️',name:'Heal',desc:'Instantly restores 25 HP. Grab it when you\'re hurt.'},
  {ico:'💣',name:'Nuke',desc:'Detonates the whole screen — clears a swarm in a pinch.'},
  {ico:'🧲',name:'XP Rush',desc:'Pulls in every XP orb on the map for an instant level-up.'},
  {ico:'🔥',name:'Overdrive',desc:'9 seconds of double fire-rate and +60% damage. Go aggressive.'},
];
const WEAPON_INFO=[
  {ico:'🚀',name:'Homing Missiles',desc:'Auto-launches a seeking missile that explodes for area damage.'},
  {ico:'🛡️',name:'Orbiting Shield',desc:'Orbs spin around you, destroying anything they touch — strong defense.'},
  {ico:'🌩️',name:'Chain Lightning',desc:'A bolt that leaps between nearby enemies, hitting several at once.'},
];
/* Evolutions + Grid Map are generated from the live registries (SYNERGIES, Nav.NODES) so the menu
   reference never drifts from the actual game rules. Recipe = the upgrade pair that triggers each evo. */
function evoInfo(){
  if(typeof SYNERGIES==='undefined')return[];
  const nm=id=>tr((typeof UPGRADES!=='undefined'&&(UPGRADES.find(u=>u.id===id)||{}).name)||id);
  return SYNERGIES.map(s=>{
    const recipe=Object.keys(s.need).map(k=>`${nm(k)} ×${s.need[k]}`).join(' + ');
    return{ico:s.ico,name:s.name,desc:`${tr('Pair')} ${recipe} — ${tr(s.desc)}.`};});}
function nodeInfo(){
  return(typeof Nav!=='undefined'&&Nav.NODES?Nav.NODES:[]).map(n=>({ico:n.ico,name:n.name,desc:n.desc}));}
function legendHTML(list){return list.map(o=>
  `<div class="legrow"><span class="lico">${o.ico}</span><div class="ltext"><b>${tr(o.name)}</b><span>${tr(o.desc)}</span></div></div>`).join('');}
function renderLegends(){
  document.getElementById('pickupsLegend').innerHTML=legendHTML(PICKUP_INFO);
  document.getElementById('weaponsLegend').innerHTML=legendHTML(WEAPON_INFO);
  const ev=document.getElementById('evoLegend');if(ev)ev.innerHTML=legendHTML(evoInfo());
  const nd=document.getElementById('nodeLegend');if(nd)nd.innerHTML=legendHTML(nodeInfo());}
