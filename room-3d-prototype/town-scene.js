import * as THREE from 'three'
export const townLand={width:102,depth:34.5,centerX:5.25,centerZ:3}
export const buildingLots=[-37,-25,38,50].flatMap((x,i)=>[-6,14].map((z,j)=>({id:`lot-${i*2+j+1}`,x,z,width:9,depth:9,status:'reserved'})))

// Static streetscape, deliberately separate from editable homes and picking.
export function buildTownScene(parent) {
  const town=new THREE.Group();town.name='四家小镇 · 公共街区';parent.add(town)
  const materials=new Map()
  const mat=c=>{if(!materials.has(c))materials.set(c,new THREE.MeshStandardMaterial({color:c,roughness:.94}));return materials.get(c)}
  const C={grass:0x99ad8e,edge:0xb6b89f,paving:0xd6cfb9,stone:0xe6dfce,wood:0x8b7159,metal:0x536663,leaf:0x708b66,lightLeaf:0x92a579,water:0x809f9a,roof:0x788c86}
  function mesh(g,c,x,y,z,p=town){const n=new THREE.Mesh(g,mat(c));n.position.set(x,y,z);n.castShadow=true;n.receiveShadow=true;p.add(n);return n}
  const box=(w,h,d,c,x,y,z,p)=>mesh(new THREE.BoxGeometry(w,h,d),c,x,y,z,p)
  const cyl=(r,h,c,x,y,z,p)=>mesh(new THREE.CylinderGeometry(r,r,h,12),c,x,y,z,p)
  function group(name,x,z){const g=new THREE.Group();g.name=name;g.position.set(x,0,z);town.add(g);return g}
  const land=box(townLand.width,.55,townLand.depth,C.edge,5.25,-.78,3);land.name='小镇土地 · 原面积三倍'
  box(101,.04,33.5,C.grass,5.25,-.49,3)
  // Extension roads meet the existing road without moving the original homes.
  for(const [x,width] of [[-33,25.5],[43.5,25.5]]){
    box(width,.12,3.6,0xb5ad97,x,-.35,6.65)
    for(const z of [4.5,8.8])box(width,.1,.65,C.paving,x,-.3,z)
    for(let dx=-width/2+1;dx<width/2;dx+=3)box(1,.012,.06,C.stone,x+dx,-.282,6.65)
  }
  for(const lot of buildingLots){
    const g=group(`建房预留地 ${lot.id}`,lot.x,lot.z);g.userData.buildingLot={...lot};g.userData.editable=false
    box(lot.width,.05,lot.depth,0xb8bea0,0,-.44,0,g)
    for(const side of [-1,1]){
      box(lot.width,.025,.1,C.stone,0,-.401,side*lot.depth/2,g)
      box(.1,.025,lot.depth,C.stone,side*lot.width/2,-.401,0,g)
      for(const z of [-lot.depth/2,lot.depth/2])box(.14,.45,.14,C.wood,side*lot.width/2,-.2,z,g)
    }
    // One path per lot ends at the nearest sidewalk, not across the road.
    const edge=lot.z<0?lot.z+lot.depth/2:lot.z-lot.depth/2
    const roadEdge=lot.z<0?4.5:8.8
    box(1.3,.06,Math.abs(edge-roadEdge),C.paving,lot.x,-.4,(edge+roadEdge)/2)
    const sign=group(`地块标牌 ${lot.id}`,lot.x-3,lot.z<0?edge-.4:edge+.4)
    box(.1,1.2,.1,C.wood,0,.15,0,sign);box(1.5,.65,.09,C.stone,0,.6,0,sign)
    // Small house-shaped emblem signals reserved residential land, not a button.
    box(.45,.24,.03,C.metal,0,.57,.065,sign)
    const roof=mesh(new THREE.ConeGeometry(.37,.24,4),C.roof,0,.81,.065,sign);roof.rotation.y=Math.PI/4;roof.scale.z=.15
  }
  box(49,.08,4.3,C.grass,5.25,-.46,-6.2)
  box(49,.1,5.4,C.paving,5.25,-.43,11.2)
  for(const x of [-18.5,29])box(2.2,.08,13,C.grass,x,-.45,1.5)
  // Walkways from all four homes to the street, keeping their existing roots.
  for(const x of [-10.5,0,10.5,21]){
    box(2.4,.1,1.8,C.stone,x,-.15,3.75)
    for(let i=0;i<5;i++)box(1.8,.025,.3,0xeee8d8,x,-.274,5.25+i*.7)
  }
  for(let x=-18;x<30;x+=1.2){box(1.16,.18,.3,C.stone,x,-.28,8.65);box(1.16,.08,.3,C.stone,x,-.36,13.85)}
  function tree(x,z,s=1){
    const g=group('行道树与树池',x,z)
    box(1.65,.2,1.65,C.stone,0,-.3,0,g);box(1.4,.05,1.4,0x79785b,0,-.18,0,g)
    cyl(.13,2.9*s,C.wood,0,1.3*s,0,g)
    for(const [dx,dy,dz,r] of [[0,3,0,1.1],[-.6,2.7,.15,.8],[.5,2.85,-.2,.9],[.1,3.65,.1,.65]]){
      const crown=mesh(new THREE.IcosahedronGeometry(r,1),dy>3?C.lightLeaf:C.leaf,dx*s,dy*s,dz*s,g);crown.scale.y=.85
    }
  }
  for(const [x,z,s] of [[-18,-5,1],[29,-4,.9],[-13,-7,1.1],[-3,-7,.85],[7,-7,1],[20,-7,.9],[-17,12,.8],[27,12,.85]])tree(x,z,s)
  function bench(x,z,turn=0){
    const g=group('木条长椅',x,z);g.rotation.y=turn
    for(let i=0;i<4;i++)box(2.15,.09,.14,C.wood,0,.34,-.25+i*.17,g)
    for(let i=0;i<3;i++)box(2.15,.13,.09,C.wood,0,.7+i*.17,-.39,g)
    for(const sx of [-.78,.78]){box(.09,.85,.09,C.metal,sx,.28,-.39,g);box(.09,.6,.09,C.metal,sx,.03,.29,g);box(.12,.09,.75,C.metal,sx,.24,0,g)}
  }
  bench(-11,12,Math.PI);bench(10.5,12,Math.PI);bench(20,11.7,Math.PI)
  function planter(x,z){const g=group('街边花箱',x,z);box(2.1,.5,.75,C.wood,0,-.13,0,g);box(1.95,.14,.65,C.leaf,0,.17,0,g);for(let i=0;i<7;i++){cyl(.035,.25,C.leaf,-.8+i*.27,.32,0,g);mesh(new THREE.IcosahedronGeometry(.11,0),i%2?0xd3ad8e:0xe2d49f,-.8+i*.27,.49,(i%2)*.12,g)}}
  for(const x of [-14,-7,14,24])planter(x,10)
  // A small central square and a low fountain: no tall object blocks interiors.
  const plaza=group('邻里小广场',1.5,11)
  cyl(2.65,.1,C.stone,0,-.34,0,plaza)
  cyl(1.15,.35,C.edge,0,-.12,0,plaza);cyl(.98,.025,C.water,0,.065,0,plaza)
  cyl(.25,.55,C.stone,0,.27,0,plaza);cyl(.65,.12,C.stone,0,.6,0,plaza);cyl(.55,.02,C.water,0,.67,0,plaza)
  // Bus shelter, timetable board and litter bin, all below room rooflines.
  const shelter=group('社区候车亭',-16,9.8)
  for(const x of [-1.3,1.3])for(const z of [-.45,.45])cyl(.06,2.45,C.metal,x,.83,z,shelter)
  box(3,.15,1.35,C.roof,0,2.1,0,shelter);box(2.5,.09,.38,C.wood,0,.3,0,shelter)
  box(.65,1,.08,C.stone,1.32,1.2,-.45,shelter)
  for(let i=0;i<5;i++)box(.45,.035,.015,C.metal,1.32,1.5-i*.13,-.395,shelter)
  for(const x of [-8,16,26]){cyl(.25,.65,C.metal,x,-.02,9.6);cyl(.29,.08,C.wood,x,.34,9.6)}
  // Parked compact delivery cart supplies a town-scale landmark.
  const car=group('街边小货车',23.5,7.45)
  box(2.5,.65,1.05,0xa8b8b1,0,.3,0,car);box(1.1,.7,.98,0xcdd5c9,.55,.91,0,car)
  box(.65,.4,.025,0x637c80,.65,1.02,.5,car);box(.025,.4,.78,0x637c80,1.115,1.02,0,car)
  for(const x of [-.8,.8])for(const z of [-.55,.55]){const wheel=cyl(.25,.12,0x454b48,x,-.05,z,car);wheel.rotation.x=Math.PI/2}
  return town
}
