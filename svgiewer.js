//  ______    _________
// / ___/ |  / / ____(_)__ _      _____  _____
// \__ \| | / / / __/ / _ \ | /| / / _ \/ ___/
//___/ /| |/ / /_/ / /  __/ |/ |/ /  __/ /
//____/ |___/\____/_/\___/|__/|__/\___/_/

// A TODA file view tool


// TODO:
// DQ hacking:
    // display-precision
    // delegation proof checking optimization
    // first twist should have zero quantity...
// turn hashes back on (check timing) -- caching atoms makes this super fast!
// svg controls (matrix transform instead of currentTranslate)
// full ADOT runtime?
// more abject details?
// highlight hitches?
// check rigs?

import { Abject } from './src/abject/abject.js'
import { DelegableActionable } from './src/abject/actionable.js'
import { DQ } from './src/abject/quantity.js'  // necessary, for some reason
import { Atoms } from './src/core/atoms.js'
import { Interpreter } from './src/core/interpret.js'
import { Line } from './src/core/line.js'
import { Twist } from './src/core/twist.js'
import { rels } from './rels.js'
// for the rigchecker:
import { SECP256r1 } from './src/client/secp256r1.js'

const TWIST = 0x48                           // SHAPES
const BODY  = 0x49
const ARB   = 0x60
const PAIRTRIE = 0x63
const HASHLIST = 0x61
const el = document.getElementById.bind(document)
const vp = el('viewport')                    // <canvas> graph viewport
const svgEl = el('viewport-svg')             // <svg> graph viewport (alternate)
const ctx = vp.getContext('2d')
let env = {}
let lastSource = {kind: 'url', name: 'dq.toda'}
let _palette = null                          // resolved CSS-var colours
let _rainbow = false                         // rainbow toggle (canvas hue-rotate)
let _rainbow_raf = 0
let _mode = 'svg'                            // 'svg' or 'canvas' rendering mode

let showpipe = pipe( buff_to_env
                   , start_timer
                   , buff_to_rough
                   , unroll_lists
                   , unzip_tries
                   , untwist_bodies
                   , twist_list
                   , have_successors
                   , get_hitched
                   , body_building
                   , get_in_line
                   , y_the_first_twist
                   , stack_lines
                   , stack_lines             // second time's the charm
                   , build_segments
                   , plonk_twists
                   , decorate_twists
                   , end_timer
                   , set_limits
                   , env => (read_palette(), build_paths(), build_spatial_index(),
                             _mode === 'svg' ? render_svg(env) : null, env)
                   , select_focus
                   , write_stats
                   , env => (sync_toggles(), env)
                   )

function buff_to_env(buff) {
    env = {buff, atoms:[], dupes:[], index:{}, shapes:{}, errors:[], firsts:[], vp:{x:0,y:0,s:1}, emojis:0, emhx:1}
    window.env = env                         // make a global for DOM consumption
    return env
}

function start_timer(env) {
    env.time = {start: performance.now()}
    return env
}

function buff_to_rough(env) {
    let i = 0, b = env.buff, lb = b.byteLength

    while(i < lb) {
        // read values
        let afirst = i
        let hash = pluck_hash(b, i)
        if(!hash) {
            env.errors.push({afirst, message: "Improper atom"})
            return env                       // oh no buff is hopeless
        }
        i += hash.length/2
        let pfirst = i

        let shape = parseInt(pluck_hex(b, i++, 1), 16)

        let length = pluck_length(b, i)
        i += 4 + length

        // set values
        let atom = {shape, hash, bin: {length, afirst, pfirst, cfirst: pfirst+5, last: i-1}}
        if(env.index[hash]) {                // OPT: this check takes 300ms w/ 10k atoms and 1M dupes,
            env.dupes.push(atom)             //      but 500ms w/ Map or Set
            continue
        }
        env.atoms.push(atom)
        env.index[hash] = atom
        ;(env.shapes[shape]||=[]).push(atom) // shapes on demand
    }

    return env
}

function unroll_lists(env) {
    env.shapes[HASHLIST]?.forEach(hl => {
        hl.list = []
        for (let i = hl.bin.cfirst; i < hl.bin.last;) {
            let k = pluck_hash(env.buff, i)
            i += leng(k)
            hl.list.push(env.index[k] || k)
        }
    })
    return env
}

function unzip_tries(env) {
    env.shapes[PAIRTRIE]?.forEach(trie => {
        trie.pairs = []
        for (let i = trie.bin.cfirst; i < trie.bin.last;) {
            let k = pluck_hash(env.buff, i)
            i += leng(k)
            let v = pluck_hash(env.buff, i)
            i += leng(v)
            trie.pairs.push([env.index[k] || k, env.index[v] || v])
        }
    })
    return env
}

function untwist_bodies(env) {
    env.shapes[BODY]?.forEach(b => {         // reverse twister all six body parts
        let i = b.bin.cfirst
        let p = pluck_hash(env.buff, i)      // order is important
        b.prev = env.index[p] || 0           // objectify prev
        if(p && !b.prev) b.prevhash = p      // display missing prevs
        let t = pluck_hash(env.buff, (i += leng(p)))
        b.teth = env.index[t] || 0           // objectify teth
        if(t && !b.teth) b.tethhash = t      // display missing teths
        b.shld = pluck_hash(env.buff, (i += leng(t)))
        // b.shwn = +env.atoms.some(x => x?.hash === b.shld)
        b.reqs = pluck_hash(env.buff, (i += leng(b.shld)))
        b.rigs = pluck_hash(env.buff, (i += leng(b.reqs)))
        b.carg = pluck_hash(env.buff, (i += leng(b.rigs)))
        b.rigtrie = env.index[b.rigs] || 0
        b.cargooo = env.index[b.carg] || 0
    })
    return env
}

function twist_list(env) {
    env.shapes[TWIST]?.forEach(t => {
        let b = pluck_hash(env.buff, t.bin.cfirst)
        t.body = env.index[b] || 0
        if(!t.body) return 0                 // that's going to leave a mark
        t.body.twist = t                     // HACK: could be multiples
        t.innies = []
        t.outies = []
        t.succ = []                          // special cased for simplicity
        t.prev = t.body.prev                 // conveniences
        t.teth = t.body.teth
    })
    return env
}

function have_successors(env) {
    env.shapes[TWIST]?.forEach(t => {        // seperate phase so everything will .succ
        if(!t.prev) return 0
        t.prev.succ.push(t)                  // HACK: doesn't check legitimacy
        if(t.prev.succ.length > 1)
            env.errors.push({twist: t, message: `Equivocation in "${t.prev.hash}"`})
    })
    return env
}

function get_hitched(env) {
    env.shapes[BODY]?.forEach(b => {         // slurps out connections. cheats a lot.
        if(!b.rigtrie) return 0
        b.rigtrie.pairs.forEach(pair => {
            let t = b.twist
            let meet = pair[1]               // HACK: doesn't check hoist
            if(!meet || meet.shape != TWIST) return 0
            if(pair[0].hash)                 // HACK: doesn't check post
                return t.outies.push([meet, 'post'])
            let lead = fastprev(meet)
            if(!lead) return 0
            t.outies.push([lead, 'lead'])
            t.outies.push([meet, 'meet'])
            lead.innies.push([t, 'leadup'])  // in edges for up direction
            meet.innies.push([t, 'meetup'])
        })
    })
    return env
}

function body_building(env) {                // causal relationships are edgy
    env.shapes[TWIST]?.forEach(t => {
        t.innies = t.innies.concat(t.succ.map(h => [h, "succ"]))
        t.outies = t.outies.concat([[t.body.prev, "prev"], [t.body.teth, "teth"]].filter(([a,b]) => a))

        let twists = get_twists(t.body.cargooo)
        twists.forEach(t1 => {
            t.outies.push([t1, "cargo"])
            t1.innies.push([t, "cargoup"])
        })
    })
    return env
}

function get_twists(a) {
    if(!a)
        return []
    if(a.shape == TWIST)
        return a
    if(a.shape == HASHLIST)
        return a.list.flatMap(a => get_twists(a))
    if(a.shape == PAIRTRIE)
        return a.pairs.flatMap(([a,b]) => get_twists(a).concat(get_twists(b)))
    return []
}

function get_in_line(env) {
    env.shapes[TWIST]?.forEach(t => {
        [t.first, t.findex] = get_first(t)
        if(!t.findex)
            env.firsts.push(t)               // a DAG root in this bag of atoms
    })
    return env
}

function get_first(a) {
    if (!a.prev)                             // creatio ex nihilo
        return [a, 0]
    else if (a.prev.first)                   // previously unknown as
        return [a.prev.first, a.prev.findex + 1]
    else                                     // get recursive on normies
        return (([a,b])=>[a,b+1])(get_first(a.prev))
}

function y_the_first_twist(env) {
    env.firsts.forEach((t,i) => t.y = i+1.5) // .5 for the atrocious ordering hack
    return env
}

function stack_lines(env) {                  // one-pass line aligner, B- for spools
    env.firsts.forEach((t,i) => {
        let min_tether = env.shapes[TWIST].filter(a=>a.first === t)
                            .reduce((acc, a) => Math.min(acc, a.teth?.first?.y||Infinity), Infinity)
        if(min_tether < t.y)                 // move lines under their lowest tether
            t.y = +((min_tether + "").slice(0,-1) + "0" + (i+1))
    })
    env.firsts.sort((a,b) => a.y - b.y).forEach((t,i) => t.y = i + .5)
    return env
}


function plonk_twists(env) {
    let x = 0, gas = 5000000, mind = 20      // gas gets us unstuck if this all goes wrong
    let lines = env.firsts.slice().reverse()
    while(lines.length) {                    // outies all required before plonking
        lines = lines.map(t => {
            if(gas-- <= 0 || t.outies.every(t=>t[0].x)) {
                t.x = x += mind
                let seg = t.segment
                if(seg?.collapsed && t === seg.first && seg.twists.length > 2) {
                    for(let i = 1; i < seg.twists.length - 1; i++)
                        seg.twists[i].x = t.x    // park intermediates at first's x
                    t = seg.last              // jump to last, placed next iteration
                } else {
                    t = t.succ[0]
                }
            }
            return t
        }).filter(t => t)
    }
    return env
}

function decorate_twists(env) {
    env.shapes[TWIST]?.forEach(t => {
        t.cx = t.x
        t.cy = 400 - t.first.y * 30
        t.colour = t.first.hash.slice(2, 8)
    })
    return env
}

const MIN_COLLAPSE = 3                       // segments smaller than this stay expanded

function build_segments(env) {               // collapse boring twist runs
    let edgeTargets = new Set()              // twists pointed to by non-prev edges
    env.shapes[TWIST]?.forEach(t => {
        t.outies.forEach(([target, type]) => {
            if(type !== 'prev') edgeTargets.add(target)
        })
    })

    env.segments = []
    env.segIndex = {}                        // seg id -> segment

    function isInteresting(t) {
        return edgeTargets.has(t) || t.outies.some(([_, type]) => type !== 'prev')
    }

    env.firsts.forEach(first => {
        let t = first, seg = []
        while(t) {
            if(isInteresting(t)) {
                if(seg.length) pushSeg(seg)
                pushSeg([t])                 // interesting twists are always standalone
                seg = []
            } else {
                seg.push(t)
            }
            t = t.succ[0]
        }
        if(seg.length) pushSeg(seg)
    })

    function pushSeg(twists) {
        let s = { twists, collapsed: twists.length >= MIN_COLLAPSE,
                  first: twists[0], last: twists[twists.length - 1],
                  id: 'seg_' + twists[0].hash.slice(0, 16) }
        twists.forEach(t => t.segment = s)
        env.segments.push(s)
        env.segIndex[s.id] = s
    }

    return env
}

function end_timer(env) {
    env.time.end = performance.now()
    return env
}

function set_limits(env) {
    let l = env.limits = {minx: Infinity, manx: -Infinity, miny: Infinity, many: -Infinity}
    env.shapes[TWIST]?.forEach(t => {
        if (t.cx < l.minx) l.minx = t.cx;
        if (t.cx > l.manx) l.manx = t.cx;
        if (t.cy < l.miny) l.miny = t.cy;
        if (t.cy > l.many) l.many = t.cy;
    })
    return env
}

// ─── canvas rendering ───
const EDGE_ORDER = ['prev', 'teth', 'lead', 'meet', 'post', 'cargo']
const TAU = Math.PI * 2
let _paths = null            // cached Path2D objects, rebuilt on layout change

function read_palette() {
    let cs = getComputedStyle(document.documentElement)
    let g = name => cs.getPropertyValue(name).trim()
    _palette = {
        ink:           g('--ink')             || '#15110b',
        paper:         g('--paper')           || '#f3efe6',
        defStroke:     g('--stroke-default')  || '#15110b',
        prev:          g('--stroke-prev')     || '#999',
        teth:          g('--stroke-teth')     || '#f9f',
        lead:          g('--stroke-lead')     || 'rgb(61,255,51)',
        meet:          g('--stroke-meet')     || '#86f',
        post:          g('--stroke-post')     || 'rgb(255,174,60)',
        cargo:         g('--stroke-cargo')    || 'rgb(255,0,0)',
        focus:         g('--stroke-focus')    || '#ff17c9',
        highlight:     g('--stroke-highlight')|| 'yellow',
        select:        g('--stroke-select')   || 'rgb(0,255,60)',
    }
    return _palette
}

function ensure_canvas_size() {
    let dpr = window.devicePixelRatio || 1
    let cw = vp.clientWidth, ch = vp.clientHeight
    let w = Math.max(1, Math.floor(cw * dpr))
    let h = Math.max(1, Math.floor(ch * dpr))
    if(vp.width !== w || vp.height !== h) { vp.width = w; vp.height = h }
}

let _raf = 0
function request_render() {
    if(_raf) return
    _raf = requestAnimationFrame(() => { _raf = 0; render_canvas(env) })
}

// Build cached Path2D objects from the current layout. The graph topology
// changes only when data loads or segments collapse/expand, so we pay the
// per-edge geometry cost once per layout instead of every frame. Each
// frame then just strokes/fills the cached paths.
function build_paths() {
    let paths = {
        edges: {},                   // {type: [solidPath2D, dashedPath2D]} — full detail
        edgesCoarse: {},             // {type: [solidPath2D, dashedPath2D]} — every 4th edge for LOD
        segConn: new Path2D(),       // straight connector line per collapsed segment
        nodesByColor: new Map(),     // {color: Path2D of all that color's circles}
        segMarkers: [],              // {x, y, color, count} list for bubble + text
    }
    for(let type of EDGE_ORDER) {
        paths.edges[type] = [new Path2D(), new Path2D()]
        paths.edgesCoarse[type] = [new Path2D(), new Path2D()]
    }

    let twists = env.shapes?.[TWIST] || []
    let edgeIdx = 0
    for(let i = 0; i < twists.length; i++) {
        let from = twists[i]
        if(!from.cx) continue
        let segA = from.segment
        if(segA?.collapsed && from !== segA.first && from !== segA.last) continue
        let outies = from.outies
        for(let j = 0; j < outies.length; j++) {
            let to = outies[j][0], type = outies[j][1]
            if(segA?.collapsed && segA === to.segment) continue
            let fx = from.cx, fy = from.cy, tx = to.cx, ty = to.cy
            if(!(fx && fy && tx && ty)) continue
            let pair = paths.edges[type]
            if(!pair) continue
            let coarse = paths.edgesCoarse[type]
            let dashIdx = fx < tx ? 1 : 0
            let p = pair[dashIdx]
            let cp = (edgeIdx & 3) === 0 ? coarse[dashIdx] : null
            p.moveTo(fx, fy)
            if(cp) cp.moveTo(fx, fy)
            if(type === 'teth') {
                let cx1 = (fx+tx+tx)/3, cy1 = (ty+fy)/2
                p.quadraticCurveTo(cx1, cy1, tx, ty)
                if(cp) cp.quadraticCurveTo(cx1, cy1, tx, ty)
            } else if(type === 'lead' || type === 'meet') {
                let cx1 = (fx+fx+tx)/3, cy1 = (ty+fy)/2
                p.quadraticCurveTo(cx1, cy1, tx, ty)
                if(cp) cp.quadraticCurveTo(cx1, cy1, tx, ty)
            } else {
                p.lineTo(tx, ty)
                if(cp) cp.lineTo(tx, ty)
            }
            edgeIdx++
        }
    }

    for(let seg of env.segments || []) {
        if(!seg.collapsed) continue
        let f = seg.first, l = seg.last
        if(!f.cx || !l.cx) continue
        paths.segConn.moveTo(f.cx, f.cy)
        paths.segConn.lineTo(l.cx, l.cy)
        let mx = (f.cx + l.cx)/2, my = f.cy
        paths.segMarkers.push({ x: mx, y: my, color: '#' + f.colour, count: seg.twists.length })
    }

    for(let i = 0; i < twists.length; i++) {
        let t = twists[i]
        if(!t.cx) continue
        let seg = t.segment
        if(seg?.collapsed && t !== seg.first && t !== seg.last) continue
        let c = '#' + t.colour
        let p = paths.nodesByColor.get(c)
        if(!p) { p = new Path2D(); paths.nodesByColor.set(c, p) }
        p.moveTo(t.cx + 5, t.cy)
        p.arc(t.cx, t.cy, 5, 0, TAU)
    }

    _paths = paths
}

function render_canvas(env) {
    if(!env || !env.shapes) return
    if(!_paths) build_paths()
    ensure_canvas_size()
    let pal = _palette || read_palette()
    let dpr = window.devicePixelRatio || 1
    let cw = vp.clientWidth, ch = vp.clientHeight
    let s = env.vp.s

    // Reset transform, clear, then apply world transform composed with dpr.
    // Set lineWidth/lineCap defaults at default-screen space so the strokes
    // come out at consistent visual thickness; we'll use ctx.lineWidth in
    // world space via setTransform inverse — but for the simple approach
    // here, set lineWidth small and accept it scales with zoom.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, vp.width, vp.height)
    ctx.filter = _rainbow
        ? `hue-rotate(${(performance.now()/30) % 360}deg) saturate(1.4) brightness(1.15)`
        : 'none'
    ctx.setTransform(s*dpr, 0, 0, s*dpr,
                     (-s*env.vp.x + cw/2) * dpr,
                     (-s*env.vp.y + ch/2) * dpr)

    // Line widths are in world units after the world transform — divide by
    // scale to keep visual thickness constant regardless of zoom.
    let invS = 1 / s
    ctx.lineCap = 'butt'

    // Level-of-detail thresholds. We pick whether to use the fine cached
    // edge paths or the every-4th coarse ones, and what opacity to draw
    // edges at — they fade out between s=0.2 and s=0.05 so the transition
    // to node-only rendering is graceful. Below s=0.05 we drop circles
    // for fillRect squares entirely.
    let LOD_RECTS  = s < 0.05
    let LOD_COARSE = s < 0.2
    let edgeAlpha  = s >= 0.2 ? 1 : Math.max(0, (s - 0.05) / 0.15)

    if(LOD_RECTS) {
        // Cheapest path: just node squares grouped by colour, no edges
        let twists = env.shapes?.[TWIST] || []
        let rectSize = Math.max(2 * invS, 1.5 * invS)
        let half = rectSize / 2
        let byColor = new Map()
        for(let i = 0; i < twists.length; i++) {
            let t = twists[i]
            if(!t.cx) continue
            let seg = t.segment
            if(seg?.collapsed && t !== seg.first && t !== seg.last) continue
            let c = '#' + t.colour
            let arr = byColor.get(c)
            if(!arr) { arr = []; byColor.set(c, arr) }
            arr.push(t.cx, t.cy)
        }
        for(let [colour, arr] of byColor) {
            ctx.fillStyle = colour
            for(let i = 0; i < arr.length; i += 2) {
                ctx.fillRect(arr[i] - half, arr[i+1] - half, rectSize, rectSize)
            }
        }
    } else {
        // 1) Stroke edges. Use coarse path (every 4th edge) below s=0.2 so
        //    the rasterizer doesn't choke on full geometry at zoom-out;
        //    fade opacity 0→1 across the transition range.
        if(edgeAlpha > 0) {
            ctx.globalAlpha = edgeAlpha
            let bag = LOD_COARSE ? _paths.edgesCoarse : _paths.edges
            for(let type of EDGE_ORDER) {
                let pair = bag[type]
                ctx.strokeStyle = pal[type]
                ctx.lineWidth = invS
                ctx.setLineDash([])
                ctx.stroke(pair[0])
                ctx.setLineDash([3 * invS])
                ctx.stroke(pair[1])
            }
            ctx.setLineDash([])
            ctx.globalAlpha = 1
        }

        // 2) Connector line between first/last of each collapsed segment
        ctx.strokeStyle = pal.prev
        ctx.lineWidth = invS
        ctx.stroke(_paths.segConn)

        // 3) Fill+stroke node circles, one batched path per colour
        ctx.lineWidth = invS
        ctx.strokeStyle = pal.defStroke
        for(let [colour, p] of _paths.nodesByColor) {
            ctx.fillStyle = colour
            ctx.fill(p)
            ctx.stroke(p)
        }
    }

    // 4) Segment markers (semitransparent bubble + count text)
    if(!LOD_RECTS && _paths.segMarkers.length) {
        ctx.setLineDash([4*invS, 2*invS])
        ctx.lineWidth = 2*invS
        ctx.strokeStyle = pal.prev
        ctx.font = (7*invS) + 'px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for(let m of _paths.segMarkers) {
            ctx.beginPath()
            ctx.moveTo(m.x + 8, m.y)
            ctx.arc(m.x, m.y, 8, 0, TAU)
            ctx.fillStyle = m.color
            ctx.globalAlpha = 0.6
            ctx.fill()
            ctx.globalAlpha = 1
            ctx.stroke()
            ctx.fillStyle = pal.ink
            ctx.fillText(String(m.count), m.x, m.y + invS)
        }
        ctx.setLineDash([])
        ctx.lineWidth = invS
    }

    // 5) Selection / highlight / focus overlays (drawn last, max three rings)
    if(_selected && _selected.cx !== undefined) {
        ctx.beginPath()
        ctx.arc(_selected.cx, _selected.cy, 8, 0, TAU)
        ctx.fillStyle = '#' + _selected.colour
        ctx.globalAlpha = 0.5
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = pal.select
        ctx.lineWidth = 3*invS
        ctx.stroke()
    }
    if(_highlighted && _highlighted.cx !== undefined) {
        ctx.beginPath()
        ctx.arc(_highlighted.cx, _highlighted.cy, 8, 0, TAU)
        ctx.strokeStyle = pal.highlight
        ctx.lineWidth = 4*invS
        ctx.globalAlpha = 0.5
        ctx.stroke()
        ctx.globalAlpha = 1
    }
    if(env.focus && env.focus.cx !== undefined) {
        ctx.beginPath()
        ctx.arc(env.focus.cx, env.focus.cy, 9, 0, TAU)
        ctx.strokeStyle = pal.focus
        ctx.lineWidth = 4*invS
        ctx.stroke()
    }

    ctx.filter = 'none'
}

// ─── spatial index for O(1) hit-testing ───
const SPATIAL_CELL = 40
let _spatial = null

function build_spatial_index() {
    _spatial = new Map()
    let push = (key, t) => {
        let arr = _spatial.get(key)
        if(!arr) { arr = []; _spatial.set(key, arr) }
        arr.push(t)
    }
    let twists = env.shapes?.[TWIST] || []
    for(let i = 0; i < twists.length; i++) {
        let t = twists[i]
        if(!t.cx) continue
        let seg = t.segment
        if(seg?.collapsed && t !== seg.first && t !== seg.last) continue
        let kx = Math.floor(t.cx / SPATIAL_CELL), ky = Math.floor(t.cy / SPATIAL_CELL)
        push(kx + ',' + ky, t)
    }
    // collapsed-segment markers are clickable too
    for(let seg of env.segments || []) {
        if(!seg.collapsed) continue
        let f = seg.first, l = seg.last
        if(!f.cx || !l.cx) continue
        let mx = (f.cx + l.cx)/2, my = f.cy
        let kx = Math.floor(mx / SPATIAL_CELL), ky = Math.floor(my / SPATIAL_CELL)
        push(kx + ',' + ky, { __seg: seg, cx: mx, cy: my })
    }
}

function hit_test(wx, wy, radius = 8) {
    if(!_spatial) return null
    let r2 = radius * radius
    let best = null, bestD = r2
    let kx = Math.floor(wx / SPATIAL_CELL), ky = Math.floor(wy / SPATIAL_CELL)
    let span = Math.max(1, Math.ceil(radius / SPATIAL_CELL))
    for(let dx = -span; dx <= span; dx++) {
        for(let dy = -span; dy <= span; dy++) {
            let arr = _spatial.get((kx+dx) + ',' + (ky+dy))
            if(!arr) continue
            for(let i = 0; i < arr.length; i++) {
                let t = arr[i]
                let ddx = t.cx - wx, ddy = t.cy - wy
                let d2 = ddx*ddx + ddy*ddy
                if(d2 < bestD) { bestD = d2; best = t }
            }
        }
    }
    return best
}

function event_to_world(e) {
    let rect = vp.getBoundingClientRect()
    let cx = e.clientX - rect.left, cy = e.clientY - rect.top
    return {
        x: (cx - vp.clientWidth/2) / env.vp.s + env.vp.x,
        y: (cy - vp.clientHeight/2) / env.vp.s + env.vp.y,
    }
}

function select_focus(env) {
    if(!env.shapes[TWIST]) {
        el('highlight').innerHTML = '<p>There are no twists in this file!</p>'
        return env
    }
    env.focus = env.shapes[TWIST][env.shapes[TWIST].length-1]
    let seg = env.focus.segment
    if(seg?.collapsed) seg.collapsed = false  // ensure focus twist is visible
    select_node(env.focus.hash)
    highlight_node(env.focus.hash)
    return env
}

function write_stats(env) {
    let twistCount = env.shapes[TWIST]?.length || 0
    let bodyCount  = env.shapes[BODY]?.length || 0
    let errCount   = env.errors.length
    el('stat-bytes').textContent       = env.buff.byteLength.toLocaleString()
    el('stat-atoms').textContent       = env.atoms.length.toLocaleString()
    el('stat-atoms-sub').textContent   = `${env.dupes.length.toLocaleString()} duplicates`
    el('stat-twists').textContent      = twistCount.toLocaleString()
    let errLink = errCount
        ? `<a href="" onclick="open_errors();return false">${errCount.toLocaleString()} errors</a>`
        : `${errCount.toLocaleString()} errors`
    el('stat-twists-sub').innerHTML    = `${bodyCount.toLocaleString()} bodies · ${errLink}`
    el('stat-parse').textContent       = `${(env.time.end-env.time.start).toFixed(0)} ms`
    el('stat-source').textContent      = lastSource.name
    el('stat-source-sub').textContent  = lastSource.kind === 'file' ? 'Uploaded' : 'Loaded from URL'
    el('errors').innerHTML = errCount ? render_errors_card(env.errors) : ''
    return env
}

function render_errors_card(errs) {
    let rows = errs.map((e, i) =>
        `<div class="err-row">
            <span class="err-marker">${i + 1}</span>
            <span class="err-msg">${munge_error_msg(e.message)}</span>
        </div>`).join('')
    return `<div class="card errors collapsed">
        <div class="h-row" onclick="toggle_card(this.parentElement)">
            <h2>Errors</h2>
            <span class="err-count">${errs.length}</span>
            <span class="card-chev">▾</span>
        </div>
        <div class="card-body">${rows}</div>
    </div>`
}

function munge_error_msg(text) {
    // shorten 66-char hashes (41/22 + 64 hex) and link them when known
    return String(text).replace(/"?((?:41|22)[0-9a-f]{64})"?/gi, (_, h) => hash_link(h))
}

function open_errors() {
    let card = el('errors')?.querySelector('.card.errors')
    if(!card) return
    card.classList.remove('collapsed')
    card.scrollIntoView({behavior: 'smooth', block: 'nearest'})
}
window.open_errors = open_errors

function probe(env) {
    console.log(env)
    return env
}

function pause(env) {
    return new Promise(k => setTimeout(() => k(env), 0))
}


// helpers

let hexes = Array.from(Array(256)).map((_,i)=>i.toString(16).padStart(2, '0'))

function pluck_hex(b, s, l) {                // requires hexes helper
    let hex = ''
    let uints = new Uint8Array(b, s, l)      // OPT: 72ms
    for(let i=0; i<l; i++)                   // OPT: 53ms
        hex += hexes[uints[i]]               // OPT: 144ms
    return hex
}

function pluck_hash(b, s) {
    let l = 0, ha = pluck_hex(b, s, 1)
    if(ha === '41')
        l = 32
    else if(ha === '22')
        l = 32
    else
        return 0
    return ha + pluck_hex(b, s + 1, l)
}

function pluck_length(b, s) {
    let v = new DataView(b, s, 4)            // 32 bit bigendian int
    return v.getUint32()
}

function leng(h) {
    return h ? h.length/2 : 1                // byte length from hex or 0
}

function fastprev(t) {
    while(t.prev) {
        if (t.prev.teth)
            return t.prev
        t = t.prev
    }
    return 0
    // return fastprev(t.prev)
}

function get(t, label) {
    return t.outies.find(e => e[1] === label)?.[0] || t.innies.find(e => e[1] === label)?.[0]
}


function pipe(...funs) {
  function magic_pipe(env={}) {
    let fun, pc=0

    function inner() {
      fun = funs[pc++]
      if(!fun) return 0                      // no fun

      if(fun.async)                          // async fun (non-promise)
        return new Promise(f => fun.async(env, f)).then(cb)

      return cb(fun(env))                    // sync fun
    }

    function cb(new_env) {
      env = new_env                          // does something

      if(env && env.constructor === Promise)
        return env.then(cb)                  // promise fun

      return inner()
    }

    return cb(env)
  }

  return magic_pipe
}


// DOM things

// Event delegation: bind to both viewport elements so handlers fire
// regardless of which mode is active. Inside each handler we branch on
// _mode to use either SVG-native DOM hit testing or canvas spatial index.
function active_vp() { return _mode === 'svg' ? svgEl : vp }

function on_wheel(e) {
    let ds = (201+Math.max(-200, Math.min(200, e.deltaY)))/200
    env.vp.s = Math.max(0.0001, Math.min(200, env.vp.s * ds))
    apply_view()
    return e.preventDefault() || false
}

function on_click(e) {
    if(_mode === 'svg') {
        if(e.target.tagName === 'circle') {
            let seg = env.segIndex?.[e.target.id]
            if(seg) return expand_segment(seg)
            select_node(e.target.id)
        }
        return
    }
    if(!_spatial) return
    let w = event_to_world(e)
    let t = hit_test(w.x, w.y, 8)
    if(!t) return
    if(t.__seg) return expand_segment(t.__seg)
    select_node(t.hash)
}

let panning = false
function on_mousedown(e) {
    panning = true
    active_vp().style.cursor = 'grabbing'
}
window.addEventListener('mouseup', e => {
    panning = false
    vp.style.cursor = ''
    svgEl.style.cursor = ''
})

window.addEventListener('mousemove', e => {
    if(panning) {
        env.vp.x -= e.movementX / env.vp.s
        env.vp.y -= e.movementY / env.vp.s
        apply_view()
        return
    }
    if(_mode === 'svg') {
        if(e.target.tagName === 'circle') highlight_node(e.target.id)
        return
    }
    if(!_spatial || e.target !== vp) return
    let w = event_to_world(e)
    let t = hit_test(w.x, w.y, 8)
    if(t && !t.__seg && t !== _highlighted) highlight_node(t.hash)
})

for(let elem of [vp, svgEl]) {
    elem.addEventListener('wheel', on_wheel)
    elem.addEventListener('mousedown', on_mousedown)
    elem.addEventListener('click', on_click)
}

window.addEventListener('keydown', e => {
    let t = _selected
    if(!t) return 0
    let key = e.keyCode
    if (key === 38)                          // up up
        select_node(get(t, 'cargoup')?.hash || get(t, 'meetup')?.hash || get(t, 'leadup')?.hash || get(t, 'post')?.hash || t.teth?.hash)
    if (key === 40)                          // down down
        select_node(get(t, 'cargo')?.hash || get(t, 'lead')?.hash || get(t, 'meet')?.hash)
    if (key === 37)                          // left right
        select_node(t.prev?.hash)
    if (key === 39)                          // left right
        select_node(t.succ[0]?.hash)
})

// theme change + resize trigger redraws (palette tokens may have changed)
window.addEventListener('resize', () => request_render())

el('todafile').oninput = function (t) {
    let file = t.srcElement.files?.[0]
    if(!file) return
    lastSource = {kind: 'file', name: file.name}
    showpipe(file.arrayBuffer())
}

el('todaurl').oninput = function (e) {
    let url = e.target.value.trim()
    window.location.hash = url
    fetch_url(url)
}

el('search').oninput = function (e) {
    let str = e.target.value
    render_hits(str)
    if(!str) return
    let t = Object.values(env.index).find(t => t.hash?.includes(str))
    if(!t) return 0
    select_node(t.hash)
}

function render_hits(query) {
    el('app').dataset.search = query
    el('hitsQuery').textContent = query || '—'
    let list = el('hitsList')
    if(!query) {
        el('hitsCount').textContent = '0 hits'
        list.innerHTML = ''
        return
    }
    let matches = Object.values(env.index || {}).filter(t => t.shape === TWIST && t.hash?.includes(query))
    el('hitsCount').textContent = `${matches.length} hit${matches.length === 1 ? '' : 's'}`
    let chips = matches.slice(0, 24).map(t => {
        let h = t.hash
        let s = short(h)
        let i = s.indexOf(query)
        let body
        if(i >= 0) {
            body = s.slice(0, i) + `<span class="pre">${s.slice(i, i + query.length)}</span>` + s.slice(i + query.length)
        } else {
            body = s   // match is in the elided middle; show short form plain
        }
        let cur = _selected?.id === h ? ' current' : ''
        return `<span class="hit${cur}" onclick="select_node('${h}')">${body}</span>`
    }).join('')
    list.innerHTML = chips
}

// DOM helpers

function fetch_url(url) {
    lastSource = {kind: 'url', name: url}
    return fetch(url)
           .then(res => showpipe(res.arrayBuffer()))
           .catch(err => console.error(err)) // stop trying to make fetch happen
}

let _selected = null, _highlighted = null   // current selected/highlighted atom refs

function relayout(env) {                     // re-run layout after collapse/expand
    env.shapes[TWIST]?.forEach(t => t.x = 0)
    plonk_twists(env)
    decorate_twists(env)
    set_limits(env)
}

function toggle_collapse() {                  // collapse/expand all segments
    let anyCollapsed = env.segments?.some(s => s.collapsed)
    let sel = _selected?.hash
    env.segments?.forEach(s => { if(s.twists.length >= MIN_COLLAPSE) s.collapsed = !anyCollapsed })
    _selected = null; _highlighted = null
    relayout(env)
    build_paths(); build_spatial_index()
    if(_mode === 'svg') render_svg(env)
    if(sel) select_node(sel)                 // restore selection (auto-expands if needed)
    scroll_to(env.vp.x, env.vp.y)
    sync_toggles()
}

function expand_segment(seg) {               // open a collapsed segment
    seg.collapsed = false
    let vx = env.vp.x, vy = env.vp.y        // preserve viewport
    _selected = null; _highlighted = null
    relayout(env)
    build_paths(); build_spatial_index()
    if(_mode === 'svg') render_svg(env)
    scroll_to(vx, vy)
    select_node(seg.first.hash)
}

function select_node(id) {
    let t = env.index?.[id]                  // global env
    if(!t) return 0
    let seg = t.segment
    if(seg?.collapsed && t !== seg.first && t !== seg.last)
        return expand_segment(seg)           // auto-expand on nav into collapsed region
    if(t.cx === undefined) return 0
    _selected = t
    sync_svg_classes()
    let html = render_twist_card(t) + render_body_card(t.body) + render_cargo_card(t.body?.cargooo)
    el('select').innerHTML = html
    show_abject_info(id)
    scroll_to(t.cx, t.cy)
}

// ─── inspector rendering helpers ───
function short(h) {
    if(!h || typeof h !== 'string') return ''
    if(h.length <= 16) return h
    return h.slice(0, 10) + '…' + h.slice(-4)
}

function display_hash(h) {
    if(!h || typeof h !== 'string') return ''
    if(env.emhx === 0) {
        if(!env.emojis) env.emojis = get_me_all_the_emoji()
        let n = env.emojis.length || 1
        let pick = (i, j) => env.emojis[parseInt(h.slice(i, j) || '0', 16) % n]
        return pick(2,10) + pick(10,18) + pick(18,26)
    }
    return short(h)
}

function hash_link(h, cls) {
    if(!h) return '—'
    let label = display_hash(h)
    let t = env.index?.[h]
    if(t?.shape === TWIST)
        return `<a class="${cls||''}" href="" onclick="select_node('${h}');return false" onmouseover="highlight_node('${h}')">${label}</a>`
    return `<span class="${cls||''}">${label}</span>`
}

function kv_row(k, vHtml, vCls) {
    return `<div class="kv"><span class="k">${k}</span><span class="v ${vCls||''}">${vHtml}</span></div>`
}

function card_open(cls, title) {
    return `<div class="card ${cls}">
        <div class="h-row" onclick="toggle_card(this.parentElement)">
            <h2>${title}</h2>
            <span class="card-chev">▾</span>
        </div>
        <div class="card-body">`
}
const card_close = `</div></div>`

function edge_types(edges) {
    // Group edges by type, keep the first target per type, render each
    // type as a link that hovers/clicks like the underlying hash would.
    let firstByType = new Map()
    edges.forEach(([target, type]) => {
        if(!firstByType.has(type)) firstByType.set(type, target?.hash)
    })
    if(firstByType.size === 0) return '—'
    return [...firstByType.entries()].map(([type, h]) =>
        h ? `<a href="" onclick="select_node('${h}');return false" onmouseover="highlight_node('${h}')">${type}</a>`
          : type
    ).join(', ')
}

function render_twist_card(t) {
    if(!t) return ''
    let body = `<div class="meta-line">shape ${t.shape} · findex ${t.findex ?? '—'}</div>`
        + kv_row('hash',   hash_link(t.hash))
        + kv_row('body',   hash_link(t.body?.hash))
        + kv_row('innies', `{ ${edge_types(t.innies||[])} }`, 'teal')
        + kv_row('outies', `{ ${edge_types(t.outies||[])} }`, 'teal')
        + kv_row('succ',   t.succ?.length ? t.succ.map(s => hash_link(s.hash)).join(', ') : '[ ]')
        + kv_row('prev',   hash_link(t.prev?.hash || t.body?.prevhash), 'teal')
        + kv_row('teth',   hash_link(t.teth?.hash || t.body?.tethhash), 'amber')
        + kv_row('first',  hash_link(t.first?.hash), 'lime')
        + kv_row('segment', t.segment?.id ? short(t.segment.id) : '—')
    return card_open('twist', 'Twist') + body + card_close
}

function render_body_card(b) {
    if(!b) return ''
    let body = `<div class="meta-line">shape ${b.shape} · reqs ${b.reqs ? short(b.reqs) : 0}</div>`
        + kv_row('hash', hash_link(b.hash))
        + kv_row('prev', hash_link(b.prev?.hash || b.prevhash), 'teal')
        + kv_row('teth', hash_link(b.teth?.hash || b.tethhash), 'amber')
        + kv_row('shld', hash_link(b.shld), 'lime')
        + kv_row('rigs', hash_link(b.rigs), 'lime')
        + kv_row('carg', hash_link(b.carg))
    if(b.rigtrie) body += render_atom_subsection('rigtrie', b.rigtrie)
    return card_open('body', 'Body') + body + card_close
}

// Render the value side of a trie pair / list item, mirroring the original
// strsmasher's resolution order: English alias by hash, then ARB literal
// unwrap, then a short (linkable when it's a known twist) hash, then a
// stringified fallback. `x` is an atom object, a raw hash string, or 0.
function smash_pair_side(x) {
    if(x === 0 || x === null || x === undefined) return '<span class="literal">0</span>'
    let h = (typeof x === 'string') ? x : x.hash
    if(h) {
        let alias = reld(h)
        if(alias) return `<span class="alias">${alias}</span>`
        if(x?.shape === ARB) {
            let raw = arb_to_twever(x)
            return typeof raw === 'string'
                ? `<span class="literal">"${raw}"</span>`
                : `<span class="literal">${raw}</span>`
        }
        return hash_link(h)
    }
    return `<span class="literal">${x}</span>`
}

// Render a nested atom (pair-trie or hash-list) as a labeled sub-section
// inside an outer card. Used for body.rigtrie and any nested cargo tries.
function render_atom_subsection(label, atom) {
    if(!atom) return ''
    let rows = ''
    if(atom.pairs) {
        atom.pairs.forEach(([k, v]) => rows += kv_row(smash_pair_side(k), smash_pair_side(v)))
    } else if(atom.list) {
        atom.list.forEach((item, i) => rows += kv_row(`[${i}]`, smash_pair_side(item)))
    } else {
        rows = kv_row('value', smash_pair_side(atom))
    }
    return `<div class="sub-section">
        <div class="sub-head">${label}<span class="sub-meta">shape ${atom.shape} · ${short(atom.hash) || ''}</span></div>
        ${rows}
    </div>`
}

// Render a single pair entry. If the value side is itself a pair-trie /
// hash-list atom, recurse into a labeled block; otherwise it's a flat
// terminal kv row.
function render_pair_entry(k, v) {
    let kHtml = smash_pair_side(k)
    if(v && typeof v === 'object' && (v.pairs || v.list)) {
        return `<div class="trie-block">
            <div class="trie-label">${kHtml}</div>
            <div class="trie-body">${render_trie_content(v)}</div>
        </div>`
    }
    return `<div class="kv"><span class="k">${kHtml}</span><span class="v">${smash_pair_side(v)}</span></div>`
}

function render_trie_body(atom) {
    let html = ''
    if(atom.pairs) {
        atom.pairs.forEach(([k, v]) => html += render_pair_entry(k, v))
    } else if(atom.list) {
        atom.list.forEach((item, i) => html += render_pair_entry(`[${i}]`, item))
    }
    return html
}

function render_trie_content(atom) {
    return `<div class="trie-meta">shape ${atom.shape} · <span class="meta-hash">${short(atom.hash) || ''}</span></div>${render_trie_body(atom)}`
}

function render_cargo_card(c) {
    if(!c) return ''
    let body = `<div class="meta-line">shape ${c.shape} · <span class="meta-hash">${short(c.hash) || ''}</span></div>`
    if(c.pairs || c.list) {
        body += render_trie_body(c)
    } else if(c.shape === ARB) {
        let raw = arb_to_twever(c)
        body += `<div class="kv"><span class="k">literal</span><span class="v"><span class="literal">${typeof raw === 'string' ? `"${raw}"` : raw}</span></span></div>`
    } else if(c.shape === TWIST) {
        body += `<div class="kv"><span class="k">twist</span><span class="v">${hash_link(c.hash)}</span></div>`
    }
    return card_open('cargo', 'Cargo') + body + card_close
}

function render_abject_card(info, ms) {
    if(!info) return ''
    let mintHtml = info.mintingInfo
        ? `<pre style="margin:0;font-size:11px;white-space:pre-wrap;word-break:break-all">${JSON.stringify(info.mintingInfo, null, 1)}</pre>`
        : '—'
    let body = `<div class="meta-line">generated in ${ms} ms</div>`
        + kv_row('quantity',  info.quantity ?? '—')
        + kv_row('precision', info.displayPrecision ?? '—')
        + kv_row('value',     info.displayValue ?? '—')
        + kv_row('minting',   mintHtml)
    return card_open('abject', 'Abject') + body + card_close
}

function toggle_card(card) { card.classList.toggle('collapsed') }

function strsmasher(k, v) {
    if(['bin', 'x', 'y', 'cx', 'cy', 'colour', 'cargooo'].includes(k))
        return x=>x                          // exclude these fields
    if(k === 'innies' || k === 'outies')     // objects look nicer
        return v.map(v => ({[v[1]] : v[0]}))
    if(k === 'pairs')                        // cargo gets rel'd
        return v.map(v => ({ [reld(v[0]) || v[0].hash || v[0] || 0] : reld(v[1]) || v[1] }))
    if(k && [TWIST,BODY].includes(v.shape)) // consume top-level
        return v.hash                       // squelch loops
    if(v.shape === ARB)
        return arb_to_twever(v)
    return v
}

function reld(v) {
    return rels?.enlang?.[v]
}

function arb_to_twever(arb) {
    let len = arb.bin.last - arb.bin.cfirst + 1
    if(len === 8)                            // hacktastic!
        return new DataView(env.buff, arb.bin.cfirst).getFloat64()
    return (new Uint8Array(env.buff, arb.bin.cfirst, len)).reduce((acc, n) => acc + String.fromCharCode(n), '')
}

function hash_munge(str) {                   // beautiful nonsense
    if(!env.emhx && !env.emojis)             // global env
        env.emojis = get_me_all_the_emoji()
    return str.replaceAll(/\s*[}{]/g, '')
              .replaceAll(/"pairs":/g, '"trie":')
              .replaceAll(/"(41.*?)"/g, (m,p) => env.index[p]?.shape !== TWIST ? m :
                `<a href="" onmouseover="highlight_node('${p}')" onclick="select_node('${p}');return false;">"${p}"</a>`)
              .replaceAll(/"(41|22)(.{64})"/g, (m,p1,p2) => env.emhx ? m :
                '"'+p2.match(/.{1,23}/g).map(n=>env.emojis[parseInt(n,16)%env.emojis.length]).join('')+'"')
}

function highlight_node(id) {
    let t = env.index?.[id]
    _highlighted = t || null
    sync_svg_classes()
    let f = env.focus?.hash
    let h = id || f
    let html = ''
    html += `<div class="focus-row"><span class="eyebrow">Focus</span>`
          + `<span class="hash-line">${f ? hash_link(f) : '—'}</span></div>`
    html += `<div class="focus-row"><span class="eyebrow">Highlight</span>`
          + `<span class="hash-line hl">${h ? hash_link(h) : '—'}</span></div>`
    el('highlight').innerHTML = html.replace(/onmouseover="[^"]*"/g, '')
    if(_mode === 'canvas') request_render()
}

function scroll_to(x, y) {
    env.vp.x = x; env.vp.y = y
    apply_view()
}

// Dispatch the active mode's view-update path. In SVG mode the rendered
// DOM is fixed and pan/zoom is a CSS transform on the gtag wrapper. In
// canvas mode, every view change is a redraw.
function apply_view() {
    if(_mode === 'svg') set_svg_transform()
    else request_render()
}

let _svgRaf = 0, _svgTx = 0, _svgTy = 0, _svgTs = 1
function set_svg_transform() {
    _svgTx = -env.vp.x * env.vp.s + svgEl.clientWidth / 2
    _svgTy = -env.vp.y * env.vp.s + svgEl.clientHeight / 2
    _svgTs = env.vp.s
    if(_svgRaf) return
    _svgRaf = requestAnimationFrame(() => {
        _svgRaf = 0
        let g = el('gtag')
        if(!g) return
        g.style.transform = `translate(${_svgTx}px,${_svgTy}px) scale(${_svgTs})`
    })
}

// Build the SVG DOM contents from current layout. Slow for huge graphs
// (one element per twist + edge), but high-fidelity at any zoom.
function render_svg(env) {
    if(!env || !env.shapes) return
    let svgs = '', edgestr = '', edges = []
    let twists = env.shapes[TWIST] || []
    for(let t of twists) {
        if(!t.cx) continue
        let seg = t.segment
        if(seg?.collapsed && t !== seg.first && t !== seg.last) continue
        svgs += `<circle cx="${t.cx}" cy="${t.cy}" r="5" fill="#${t.colour}" id="${t.hash}"/>`
        for(let o of t.outies) edges.push([t, o[0], o[1]])
    }
    edges.sort((a, b) => EDGE_ORDER.indexOf(a[2]) - EDGE_ORDER.indexOf(b[2]))
    for(let [from, to, type] of edges) {
        let s1 = from.segment
        if(s1?.collapsed && s1 === to.segment) continue
        let fx = from.cx, fy = from.cy, tx = to.cx, ty = to.cy
        if(!(fx && fy && tx && ty)) continue
        let dashed = fx < tx ? ' dashed' : ''
        if(type === 'teth')
            edgestr += `<path d="M ${fx} ${fy} Q ${(fx+tx+tx)/3} ${(ty+fy)/2} ${tx} ${ty}" class="${type}${dashed}"/>`
        else if(type === 'lead' || type === 'meet')
            edgestr += `<path d="M ${fx} ${fy} Q ${(fx+fx+tx)/3} ${(ty+fy)/2} ${tx} ${ty}" class="${type}${dashed}"/>`
        else
            edgestr += `<path d="M ${fx} ${fy} L ${tx} ${ty}" class="${type}${dashed}"/>`
    }
    for(let seg of env.segments || []) {
        if(!seg.collapsed) continue
        let f = seg.first, l = seg.last
        if(!f.cx || !l.cx) continue
        edgestr += `<path d="M ${f.cx} ${f.cy} L ${l.cx} ${l.cy}" class="prev"/>`
        let mx = (f.cx + l.cx)/2, my = f.cy
        svgs += `<circle cx="${mx}" cy="${my}" r="8" fill="#${f.colour}" id="${seg.id}" opacity="0.6"/>`
        svgs += `<text x="${mx}" y="${my+3}" text-anchor="middle" font-size="7" fill="#000" pointer-events="none">${seg.twists.length}</text>`
    }
    svgEl.innerHTML = `<g id="gtag" style="will-change:transform">${edgestr}${svgs}</g>`
    set_svg_transform()
    sync_svg_classes()
}

// Mirror the atom-ref selection/highlight/focus state onto SVG circles
// as CSS classes. No-op in canvas mode (which draws overlays each frame).
let _svgSelectedEl = null, _svgHighlightedEl = null, _svgFocusEl = null
function sync_svg_classes() {
    if(_mode !== 'svg') return
    let sel = _selected ? document.getElementById(_selected.hash) : null
    let hl  = _highlighted ? document.getElementById(_highlighted.hash) : null
    let fc  = env.focus ? document.getElementById(env.focus.hash) : null
    if(_svgSelectedEl && _svgSelectedEl !== sel) _svgSelectedEl.classList?.remove('select')
    if(_svgHighlightedEl && _svgHighlightedEl !== hl) _svgHighlightedEl.classList?.remove('highlight')
    if(_svgFocusEl && _svgFocusEl !== fc) _svgFocusEl.classList?.remove('focus')
    sel?.classList.add('select')
    hl?.classList.add('highlight')
    fc?.classList.add('focus')
    _svgSelectedEl = sel; _svgHighlightedEl = hl; _svgFocusEl = fc
}

function set_mode(m) {
    if(m !== 'svg' && m !== 'canvas') return
    _mode = m
    el('app').dataset.mode = m
    if(m === 'svg') {
        render_svg(env)
    } else {
        request_render()
    }
    sync_toggles()
}

function toggle_mode() {
    set_mode(_mode === 'svg' ? 'canvas' : 'svg')
}

function showhide(id) {
    el(id)?.classList?.toggle('hidden')
}

function show_abject_info(id) {
    try {
        el('rigcheck').innerHTML = ''
        let time = performance.now()
        if(!env.abject_atoms) {
            let uint = new Uint8Array(env.buff)
            env.abject_atoms = Atoms.fromBytes(uint)
        }
        let twist = new Twist(env.abject_atoms, id)
        let abject = Abject.fromTwist(twist)

        env.info = { quantity: abject.quantity, displayPrecision: abject.displayPrecision
                   , displayValue: DQ.quantityToDisplay(abject.quantity, abject.displayPrecision)
                   , mintingInfo: abject.mintingInfo } //, root: env.abject.rootContext()}
        let newtime = performance.now()
        let abjectMs = (newtime-time).toFixed(1)
        el('abject').innerHTML = render_abject_card(env.info, abjectMs)
        el('stat-parse-sub').textContent = `abject info ${abjectMs} ms`

        abject.checkAllRigs().then(_ => {
            el('rigcheck').innerHTML = `<span class="pass">PASS</span><span class="ms">${(performance.now()-newtime).toFixed(1)} ms</span>`
        }).catch(_ => {

            // //XXX(sfertman): BEGIN ~~ TODA INSTANT REALAY CERTIFIED HACK ~~

            // --- Optimized TwinInterpreter (pre-computed topline set) ---
            class TwinInterpreter extends Interpreter {
                _getAllTethers() {
                    if(this._tethers) return this._tethers

                    let tethers = []
                    let prevTwist = this.line.twist(this.line.latestTwist())
                    let abj
                    try {
                        abj = Abject.fromTwist(prevTwist)
                    } catch(_e) {}
                    while(prevTwist) {
                        if(prevTwist.getTetherHash()) {
                            tethers.push(prevTwist.getTetherHash())
                        }
                        prevTwist = prevTwist.prev()
                    }
                    if(abj && abj instanceof DelegableActionable) {
                        for(let delegate of abj.delegationChain()) {
                            prevTwist = new Twist(abj.atoms, delegate.twistHash)
                            while(prevTwist) {
                                if(prevTwist.getTetherHash()) {
                                    tethers.push(prevTwist.getTetherHash())
                                }
                                prevTwist = prevTwist.prev()
                            }
                        }
                    }

                    this._tethers = tethers
                    return tethers
                }

                _buildToplineSet() {
                    if(this._toplineSet) return this._toplineSet

                    const s = new Set()

                    const collectChain = (startHash) => {
                        // Walk backwards
                        let h = startHash
                        while(h && !s.has(h.toString())) {
                            s.add(h.toString())
                            h = this.line.prev(h)
                        }
                        // Walk forwards
                        h = this.line.successor(startHash)
                        while(h && !s.has(h.toString())) {
                            s.add(h.toString())
                            h = this.line.successor(h)
                        }
                    }

                    // Topline
                    collectChain(this.topHash)

                    // All tether chains
                    for(const tether of this._getAllTethers()) {
                        collectChain(tether)
                    }

                    this._toplineSet = s
                    return s
                }

                isTopline(hash) {
                    return this._buildToplineSet().has(hash.toString())
                }
            }
            
            DelegableActionable.prototype._constructInterpreter = function () {
                return new TwinInterpreter(new Twist(this.atoms, this.twistHash), this.poptop());
            };
              
            const ti = new TwinInterpreter(Line.fromTwist(twist), abject.poptop());
            return ti.verifyTopline()
                .then(_ => ti.verifyHitchLine(twist.getHash()))
                .then(_ => el('rigcheck').innerHTML = `<span class="pass">RELAY</span><span class="ms">${(performance.now()-newtime).toFixed(1)} ms</span>`)
            // //XXX(sfertman): END ~~ TODA INSTANT REALAY CERTIFIED HACK ~~
        }).catch(e => {
            el('rigcheck').innerHTML = `<span class="pass fail">FAIL</span><span class="ms">${(performance.now()-newtime).toFixed(1)} ms</span>`
            console.error(e)
        });
    } catch(e) {
        el('abject').innerHTML = ''
        el('rigcheck').innerHTML = `<span class="ms">Not an abject</span>`
        el('stat-parse-sub').textContent = ''
    }
}

const SVG_EXPORT_STYLES = `
    circle { stroke: #15110b; stroke-width: 1; }
    path { fill: none; }
    .prev  { stroke: #999; stroke-linecap: butt; }
    .teth  { stroke: #f9f; stroke-linecap: butt; }
    .lead  { stroke: rgb(61,255,51); stroke-linecap: butt; }
    .meet  { stroke: #86f; stroke-linecap: butt; }
    .post  { stroke: rgb(255,174,60); stroke-linecap: butt; }
    .cargo { stroke: rgb(255,0,0); stroke-linecap: butt; }
    .dashed { stroke-dasharray: 3; }
    .focus { r: 9; stroke-width: 4; stroke: #ff17c9; }
    .highlight { r: 8; stroke-width: 4; stroke-opacity: 50%; stroke: yellow; }
    .select { r: 8; fill-opacity: 50%; stroke-width: 3; stroke: rgb(0,255,60); }
`

function download_svg() {
    if(!env.focus) return
    let w = env.limits.manx - env.limits.minx + 20
    let h = env.limits.many - env.limits.miny + 30
    let viewBox = `${env.limits.minx - 10} ${env.limits.miny - 10} ${w} ${h}`
    let head = `<svg title="graph" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`
    let style = "<style>" + SVG_EXPORT_STYLES + "</style>"
    let full_svg = head + style + build_export_svg() + "</svg>"

    let blob = new Blob([full_svg], {type: "image/svg+xml"})
    let link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = env.focus.hash + ".svg"
    link.click()
    URL.revokeObjectURL(link.href)
}

// Build an SVG string from the current env data (replaces the old
// DOM-scraping export — canvas has no DOM to read).
function build_export_svg() {
    let svgs = '', edgestr = ''
    let twists = env.shapes[TWIST] || []
    let edges = []
    for(let t of twists) {
        if(!t.cx) continue
        let seg = t.segment
        if(seg?.collapsed && t !== seg.first && t !== seg.last) continue
        svgs += `<circle cx="${t.cx}" cy="${t.cy}" r="5" fill="#${t.colour}" id="${t.hash}"/>`
        for(let [target, type] of t.outies) edges.push([t, target, type])
    }
    edges.sort((a, b) => EDGE_ORDER.indexOf(a[2]) - EDGE_ORDER.indexOf(b[2]))
    for(let [from, to, type] of edges) {
        let segA = from.segment
        if(segA?.collapsed && segA === to.segment) continue
        let fx = from.cx, fy = from.cy, tx = to.cx, ty = to.cy
        if(!(fx && fy && tx && ty)) continue
        let dashed = fx < tx ? ' dashed' : ''
        if(type === 'teth')
            edgestr += `<path d="M ${fx} ${fy} Q ${(fx+tx+tx)/3} ${(ty+fy)/2} ${tx} ${ty}" class="${type}${dashed}"/>`
        else if(type === 'lead' || type === 'meet')
            edgestr += `<path d="M ${fx} ${fy} Q ${(fx+fx+tx)/3} ${(ty+fy)/2} ${tx} ${ty}" class="${type}${dashed}"/>`
        else
            edgestr += `<path d="M ${fx} ${fy} L ${tx} ${ty}" class="${type}${dashed}"/>`
    }
    for(let seg of env.segments || []) {
        if(!seg.collapsed) continue
        let f = seg.first, l = seg.last
        if(!f.cx || !l.cx) continue
        edgestr += `<path d="M ${f.cx} ${f.cy} L ${l.cx} ${l.cy}" class="prev"/>`
        let mx = (f.cx + l.cx)/2, my = f.cy
        svgs += `<circle cx="${mx}" cy="${my}" r="8" fill="#${f.colour}" id="${seg.id}" opacity="0.6"/>`
        svgs += `<text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="7" fill="#000">${seg.twists.length}</text>`
    }
    return edgestr + svgs
}

function rainbowsparkles() {
    _rainbow = !_rainbow
    if(_rainbow && !_rainbow_raf) {
        let tick = () => {
            if(!_rainbow) { _rainbow_raf = 0; return }
            request_render()
            _rainbow_raf = requestAnimationFrame(tick)
        }
        _rainbow_raf = requestAnimationFrame(tick)
    }
    sync_toggles()
    request_render()
}

function emojex() {
    env.emhx ^= 1
    if(_selected) select_node(_selected.hash)
    if(_highlighted) highlight_node(_highlighted.hash)
    sync_toggles()
}

function sync_toggles() {
    let toggles = document.querySelectorAll('.toggles span')
    if(toggles.length < 3) return
    let [emo, mode, rain] = toggles   // [emoji/hex, svg/canvas, rainbow, download]
    emo.classList.toggle('on', env.emhx === 0)   // .on in emoji mode
    mode.classList.toggle('on', _mode === 'canvas')  // .on in canvas mode
    rain.classList.toggle('on', _rainbow)
}

function get_me_all_the_emoji() {            // over-the-top emoji fetching courtesy of bogomoji
    let testCanvas = document.createElement("canvas")
    let miniCtx = testCanvas.getContext('2d', {willReadFrequently: true})
    let q = []
    let MAGICK_EMOJI_NUMBER = 127514
    for (let i = 0; i < 2000; i++) {
        let char = String.fromCodePoint(MAGICK_EMOJI_NUMBER + i)
        if (is_char_emoji(miniCtx, char))
            q.push(char)
    }
    return q
}
function is_char_emoji(ctx, char) {
    let size = ctx.measureText(char).width
    if (!size) return false
    ctx.clearRect(0, 0, size + 3, size + 3)  // three is a lucky number
    ctx.fillText(char, 0, size)              // probably chops off the emoji edges
    let data = ctx.getImageData(0, 0, size, size).data
    for (var i = data.length - 4; i >= 0; i -= 4)
        if (!is_colour_boring(data[i], data[i + 1], data[i + 2]))
            return true
    return false
}
function is_colour_boring(r, g, b) {         // if the pixel is not black, white, or red,
    let s = r + g + b                        // then it probably belongs to an emoji
    return (!s || s === 765 || s === 255 && s === r)
}


// export UI functions
window.rainbowsparkles = rainbowsparkles
window.highlight_node = highlight_node
window.download_svg = download_svg
window.select_node = select_node
window.showhide = showhide
window.emojex = emojex
window.slurp = slurp
window.toggle_collapse = toggle_collapse
window.expand_segment = expand_segment
window.toggle_card = toggle_card
window.toggle_mode = toggle_mode

// aside open/close
el('closeAside')?.addEventListener('click', () => el('app').dataset.aside = 'closed')
el('openAside')?.addEventListener('click', () => el('app').dataset.aside = 'open')

// theme toggle — mirror data-theme onto <html> so the dark tokens
// cascade to body background too (custom props inherit downward, but
// .app overrides never reach the html/body bg).
function set_theme(t) {
    el('app').dataset.theme = t
    document.documentElement.dataset.theme = t
    read_palette()   // re-resolve --stroke-* / --ink etc. for canvas
    request_render()
}
if(matchMedia('(prefers-color-scheme: dark)').matches && el('app').dataset.theme === 'light')
    set_theme('dark')
else
    set_theme(el('app').dataset.theme || 'light')
el('themeBtn')?.addEventListener('click', () => {
    set_theme(el('app').dataset.theme === 'dark' ? 'light' : 'dark')
})


// init
let url = window.location.hash.slice(1)
if(url) {
    el('todaurl').value = url
    fetch_url(url)
} else {
    fetch_url('dq.toda')
}

// experimental dump slurp func
function slurp(url, hashes) {
    let slurped = {}
    let waiting = 0
    let byteslist = []

    hashes.forEach(go)

    function go(hash) {
        if (slurped[hash]) return false
        slurped[hash] = true
        waiting++
        let furl = url + '/' + hash + '.next.toda'
        fetch(furl)
        .then(res => res.arrayBuffer())
        .then(buff => get_hashes(buff))
        .then(hashes => hashes.forEach(go))
        .then(_ => --waiting ? 0 : showpipe(concatter(byteslist)))
        // .catch(e => e)
    }

    function concatter(byteslist) {
        return (new Uint8Array(byteslist)).buffer
    }

    function get_hashes(buff) {
        let hashes = []
        let uints = new Uint8Array(buff) // TODO: unify uint/uints
        if(uints[0] !== 0x41) {
            // console.error(buff)
            return []
        }
        byteslist.push.apply(byteslist, [...uints])

        for(let i=0, l=uints.length-32; i<l; i++)
            if(uints[i] === 0x41)
                hashes.push(pluck_hash(buff, i))

        return hashes
    }

    // get all the hashes
    // add them to done
    // get all their hashes
    // filter by done
    // when no hashes smoosh buffers and call showpipe

    // - in the future, render iteratively...
}

