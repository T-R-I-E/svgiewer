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

import { DQ } from './src/abject/quantity.js'  // necessary, for some reason
import { Atoms } from './src/core/atoms.js'
import { Twist } from './src/core/twist.js'
import { Abject } from './src/abject/abject.js'
import { rels } from './rels.js'
// for the rigchecker:
import { SECP256r1 } from './src/client/secp256r1.js'

const TWIST = 0x48                           // SHAPES
const BODY  = 0x49
const ARB   = 0x60
const PAIRTRIE = 0x63
const HASHLIST = 0x61
const el = document.getElementById.bind(document)
const vp = el('viewport')                    // svg canvas
let env = {}

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
                   , plonk_twists
                   , decorate_twists
                   , end_timer
                   , set_limits
                   , render_svg
                   , select_focus
                   , write_stats
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
    let x = 0, gas = 1000000, mind = 20      // gas gets us unstuck if this all goes wrong
    let lines = env.firsts.slice().reverse()
    while(lines.length) {                    // outies all required before plonking
        lines = lines.map(t => {
            if(gas-- <= 0 || t.outies.every(t=>t[0].x)) {
                t.x = x += mind
                t = t.succ[0]
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

function render_svg(env) {
    let svgs = '', edgestr = '', edges = []
    let order = ['prev', 'teth', 'lead', 'meet', 'post', 'cargo']
    env.shapes[TWIST]?.forEach(t => {
        if(!t.cx) return 0                   // ignore equivocal successors
        svgs += `<circle cx="${t.cx}" cy="${t.cy}" r="5" fill="#${t.colour}" id="${t.hash}" />`
        edges = edges.concat(t.outies.map(o => [t, o[0], o[1]]))
    })
    edges.sort((a,b) => order.indexOf(a[2]) - order.indexOf(b[2]))
         .forEach(e => {                     // prev and teth at back for style
        let fx = e[0].cx, fy = e[0].cy, tx = e[1].cx, ty = e[1].cy
        if(!(fx && fy && tx && ty)) return 0 // also eq successor
        let dashed = e[0].cx < e[1].cx ? 'dashed' : ''
        if(e[2] === 'teth')
            edgestr += `<path d="M ${fx} ${fy} Q ${(fx+tx+tx)/3} ${(ty+fy)/2} ${tx} ${ty}" class="${e[2]} ${dashed}"/>`
        else if(e[2] === 'lead' || e[2] === 'meet')
            edgestr += `<path d="M ${fx} ${fy} Q ${(fx+fx+tx)/3} ${(ty+fy)/2} ${tx} ${ty}" class="${e[2]} ${dashed}"/>`
        else
            edgestr += `<path d="M ${fx} ${fy} ${tx} ${ty}" class="${e[2]} ${dashed}"/>`
    })
    vp.innerHTML = '<g id="gtag">' + edgestr + svgs + '</g>'
    return env
}

function select_focus(env) {
    if(!env.shapes[TWIST])
        el('stats').innerHTML = 'There are no twists in this file!'
    env.focus = env.shapes[TWIST][env.shapes[TWIST].length-1]
    el(env.focus.hash).classList.add('focus')
    select_node(env.focus.hash)
    highlight_node(env.focus.hash)
    return env
}

function write_stats(env) {
    el('stats').innerHTML =
    `<p>Analyzed ${env.buff.byteLength.toLocaleString()} bytes
        containing ${env.atoms.length.toLocaleString()} atoms
        with ${env.dupes.length.toLocaleString()} duplicates
        in ${(env.time.end-env.time.start).toFixed(0)}ms. </p>
     <p>There are ${env.shapes[TWIST].length.toLocaleString()} twists,
        ${env.shapes[BODY].length.toLocaleString()} bodies,
        and <a href="" onclick="showhide('errors');return false">${env.errors.length.toLocaleString()} errors</a>. </p>
     <p><a href="" onclick="emojex();return false">emoji/hex</a>
        <a href="" onclick="rainbowsparkles();return false">rainbow/sparkles</a>
        <a href="" onclick="download_svg();return false">download as svg</a> </p>
     <div id="errors" class="hidden"><p>${hash_munge(env.errors.map(e=>e.message).join('</p><p>'))}</p></div>`
    return env
}

function probe(env) {
    console.log(env)
    return env
}

function pause(env) {
    return new Promise(k => setTimeout(() => k(env), 0))
}


// helpers

let hexes = Array.from(Array(256)).map((n,i)=>i.toString(16).padStart(2, '0'))

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
    if(!t.prev) return 0
    if(t.prev.teth)
        return t.prev
    return fastprev(t.prev)
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

vp.addEventListener('wheel', e => {
    let ds = (201+Math.max(-200, Math.min(200, e.deltaY)))/200
    let s = Math.max(0.02, Math.min(200, env.vp.s * ds))
    env.vp.s = s                             // global env
    scroll_to(env.vp.x, env.vp.y)
    return e.preventDefault() || false
})

let panning=false
vp.addEventListener('mousedown', e => panning = true)
vp.addEventListener('mouseup', e => panning = false)
vp.addEventListener('click', e => {
    if(e.target.tagName === 'circle') {
        select_node(e.target.id)
    }
})
vp.addEventListener('mousemove', e => {
    if (e.target.tagName === 'circle') {
        highlight_node(e.target.id)
    }
    if(panning) {
        scroll_to(env.vp.x - e.movementX / env.vp.s, env.vp.y - e.movementY / env.vp.s)
    }
})

window.addEventListener('keydown', e => {
    if(typeof env === 'undefined') return true
    let key = e.keyCode, id = document.getElementsByClassName('select')[0]?.id
    let t = env.index?.[id]                  // global env
    if (!id || !t) return 0
    if (key === 38)                          // up up
        select_node(get(t, 'cargoup')?.hash || get(t, 'meetup')?.hash || get(t, 'leadup')?.hash || get(t, 'post')?.hash || t.teth?.hash)
    if (key === 40)                          // down down
        select_node(get(t, 'cargo')?.hash || get(t, 'lead')?.hash || get(t, 'meet')?.hash)
    if (key === 37)                          // left right
        select_node(t.prev.hash)
    if (key === 39)                          // left right
        select_node(t.succ[0]?.hash)
})

el('todafile').onchange = function (t) {
    let file = t.srcElement.files?.[0]
    showpipe(file.arrayBuffer())
}

el('todaurl').onchange = function (e) {
    let url = e.target.value.trim()
    window.location.hash = url
    fetch_url(url)
}

// DOM helpers

function fetch_url(url) {
    return fetch(url)
           .then(res => showpipe(res.arrayBuffer()))
           .catch(err => console.error(err)) // stop trying to make fetch happen
}

function select_node(id) {
    let t = env.index?.[id], dom = el(id)    // global env
    if (!t || !dom) return 0
        ;[...document.querySelectorAll('.select')].map(n => n.classList.remove('select'))
    dom.classList.add('select')
    let html = ''
    html += `Twist<pre>${JSON.stringify(t,              strsmasher, 1)}</pre>`
    html += `Body <pre>${JSON.stringify(t.body,         strsmasher, 1)}</pre>`
    html += `Cargo<pre>${JSON.stringify(t.body.cargooo, strsmasher, 1)}</pre>`
    el('select').innerHTML = hash_munge(html)
    // setTimeout(x => show_abject_info(id), 0) // pause for responsiveness
    show_abject_info(id)
    scroll_to(t.cx, t.cy)
}

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
    ;[...document.querySelectorAll('.highlight')].map(n => n.classList.remove('highlight'))
    el(id)?.classList?.add('highlight')
    let html  = `<p>Focus: ${hash_munge('"'+env.focus.hash+'"')}</p>`
        html += `<p>Highlight: "${id}"</p>`  // focus is here so it refreshes w/ emojihex
    el('highlight').innerHTML = hash_munge(html).replace(/onmouseover=".*?"/, '') // does not play well with onclick
}

function scroll_to(x, y) {
    env.vp.x = x                             // global env
    env.vp.y = y
    let tx = -x * env.vp.s + vp.clientWidth / 2
    let ty = -y * env.vp.s + vp.clientHeight / 2
    set_transform(tx, ty, env.vp.s)
}

function set_transform(x, y, s) {
    let g = el('gtag')
    if(!g) return
    g.setAttribute('transform', `translate(${x},${y}) scale(${s})`)
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
        el('abject').innerHTML = "Abject info: " + JSON.stringify(env.info, 0, 2) + ` in ${(newtime-time).toFixed(1)}ms`

        abject.checkAllRigs().then(_ => {
            el('rigcheck').innerHTML = `Rigs checked successfully in ${(performance.now()-newtime).toFixed(1)}ms!`
        }).catch(e => {
            el('rigcheck').innerHTML = `Rig check failed, consuming ${(performance.now()-newtime).toFixed(1)}ms of precious battery life`
            console.error(e)
        })
    } catch(e) {
        el('abject').innerHTML = 'Not an abject'
        el('rigcheck').innerHTML = ''
    }
}

function download_svg() {
    let head = `<svg title="graph" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="${env.limits.minx - 10} ${env.limits.miny - 10} ${env.limits.manx + 10} ${env.limits.many + 20}">`;
    let style = "<style>" + el('style').innerHTML + "</style>";
    let svg_data = vp.innerHTML;
    let full_svg = head + style + svg_data + "</svg>";

    let blob = new Blob([full_svg], {type: "image/svg+xml"});
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = env.focus.hash + ".svg";
    link.click();
    URL.revokeObjectURL(link.href);
}

function rainbowsparkles() {
    ;[...document.querySelectorAll('path')].map(p=>p.classList.toggle('rainbowsparkles'))
    ;[...document.querySelectorAll('circle')].map(p=>p.classList.toggle('nodesparkles'))
}

function emojex() {
    env.emhx ^= 1
    select_node(document.getElementsByClassName('select')[0]?.id)
    highlight_node(document.getElementsByClassName('highlight')[0]?.id)
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


// init
let url = window.location.hash.slice(1)
if(url) {
    el('todaurl').value = url
    fetch_url(url)
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
