//
// TODA file view tool
//

// TODO:
// layout nodes
// highlight hitches
// later:
// hash check
// shape check
// sig check
// hitch check
// rig check
// make multi-successors a different size? (or a red ring?)

// mark focus twist some other way... (maybe just link it in the sidebar)
// scroll to highlight (?)
// click to select
// arrows to navigate?


const TWIST = 48
const BODY  = 49
const el = document.getElementById.bind(document)

const vp = el('viewport')
vp.addEventListener('wheel', e => {
    e.preventDefault()
    let dy = (201+Math.max(-200, Math.min(200, e.deltaY)))/200
    if((dy < 1 && vp.currentScale < 0.002) || (dy > 1 && vp.currentScale > 200)) return false
    vp.currentScale *= dy
    vp.currentTranslate.y = vp.currentTranslate.y * dy + vp.clientWidth * (1 - dy)
    vp.currentTranslate.x = vp.currentTranslate.x * dy + vp.clientHeight * (1 - dy)
})
let panning=false
vp.addEventListener('mousedown', e => panning = true)
vp.addEventListener('mouseup', e => panning = false)
vp.addEventListener('click', e => {
    if(e.target.tagName === 'circle') {
        show_node(e.target.id)
    }
})
vp.addEventListener('mousemove', e => {
    if (e.target.tagName === 'circle') {
        highlight_node(e.target.id)
    }
    if(panning) {
        vp.currentTranslate.x += e.movementX * 3
        vp.currentTranslate.y += e.movementY * 3
    }
})

let showpipe = pipe( wrap('name', import_file, 'buff')
                   , start_timer
                   , buff_to_rough
                   , untwist_bodies
                   , rigging_try
                   , twist_list
                   , get_hitched
                   , have_successors
                   , get_in_line
                   , stack_lines
                   , scooch_atoms
                   , end_timer
                   , render_svg
                   , write_stats
                   , probe
                   )

showpipe()

// import binary
// TODO: probably just feed the raw buffer into this pipeline instead
function import_file(env) {
    // return fetch('plain.toda')
    // return fetch('super.toda')
    return fetch('mega.toda')
           .then(res => res.arrayBuffer())
}

function start_timer(env) {
    env.time = {start: performance.now()}
    return env
}

// binary buffer to rough atoms
function buff_to_rough(env) {
    let i = 0, b = env.buff, lb = b.byteLength
    env.atoms = []
    env.dupes = []
    env.index = {}
    env.shapes = {}
    env.errors = []

    while(i < lb) {
        // read values
        let afirst = i
        let hash = pluck_hash(b, i)
        if(!hash) {
            env.errors.push({afirst, message: "Improper atom"})
            return env // stop trying to process buff
        }
        i += hash.length/2
        let pfirst = i

        let shape = pluck_hex(b, i++, 1)

        let length = pluck_length(b, i)
        i += 4 + length

        // set values
        let atom = {shape, hash, bin: {length, afirst, pfirst, cfirst: pfirst+5, last: i-1}}
        if(env.index[hash]) { // OPT: profiler says this is slow (300ms) when there's 10k atoms (1M dupes)... but it's 500ms w/ Map :/
            env.dupes.push(atom)
            continue
        }
        env.atoms.push(atom)
        env.index[hash] = atom
        if(!env.shapes[shape])
            env.shapes[shape] = [atom]
        else
            env.shapes[shape].push(atom)
    }

    return env
}

function untwist_bodies(env) {
    env.shapes[BODY].forEach(a => {
        let i = a.bin.cfirst
        let p = pluck_hash(env.buff, i)
        a.prev = env.index[p] || 0
        let t = pluck_hash(env.buff, (i += leng(p)))
        a.teth = env.index[t] || 0
        a.shld = pluck_hash(env.buff, (i += leng(t)))
        a.reqs = pluck_hash(env.buff, (i += leng(a.shld)))
        a.rigs = pluck_hash(env.buff, (i += leng(a.reqs)))
        a.carg = pluck_hash(env.buff, (i += leng(a.rigs)))
    })
    return env
}

function rigging_try(env) {
    env.shapes[BODY].forEach(a => {
        a.hoists = []
        a.posts  = []
        a.rigtrie = pairtrier(a.rigs, env)
    })
    return env
}

function twist_list(env) {
    env.shapes[TWIST].forEach(a => {
        let b = pluck_hash(env.buff, a.bin.cfirst)
        a.body = env.index[b] || 0
        if(!a.body)
            return 0
        a.prev = a.body.prev // convenience
        a.teth = a.body.teth
        a.hoists = a.body.hoists
        a.posts = a.body.posts
    })
    return env
}

function get_hitched(env) {
    env.shapes[BODY].forEach(a => {
        if(!a.rigtrie) return 0
        a.rigtrie.pairs.forEach(pair => {
            let meet = env.index[pair[1]] // NOTE: this is a cheap hack
            if(!meet) return 0
            if(env.index[pair[0]])
                return a.posts.push(meet) // NOTE: another cheap hack
            let lead = fastprev(meet)
            a.hoists.push([lead, meet])
        })
    })
    return env
}

function have_successors(env) {
    env.shapes[TWIST].forEach(a => {
        if(!a.prev) return 0
        if(!a.prev.succ)
            a.prev.succ = []
        a.prev.succ.push(a)
    })
    return env
}

function get_in_line(env) {
    env.firsts = []
    env.shapes[TWIST].forEach(a => {
        [a.first, a.findex] = get_first(a)
        if(!a.findex)
            env.firsts.push(a) // [a.first.hash] = {first: a.first} // , max_length: 1}
    })
    return env
}

function get_first(a) {
    if (!a.prev)
        return [a, 0]
    else if (a.prev.first)
        return [a.prev.first, a.prev.findex + 1]
    else
        return (([a,b])=>[a,b+1])(get_first(a.prev))
}

function stack_lines(env) {
    env.firsts.forEach((t,i) => t.y = i+1.5)
    env.firsts.forEach((t,i) => {
        let min_tether = env.shapes[TWIST].filter(a=>a.first === t).reduce((acc, a) => Math.min(acc, a.teth?.first?.y||Infinity), Infinity)
        if(min_tether < t.y) // move lines under their lowest tether (can get messy with spools etc)
            t.y = +((min_tether + "").slice(0,-1) + "0" + (i+1))
    })
    env.firsts.sort((a,b) => a.y - b.y).forEach((t,i) => t.y = i)
    return env
}

function scooch_lines(env) {
    // move a whole line around...
    return env
}

function scooch_atoms(env) {
    for(let i = env.shapes[TWIST].length-1; i >= 0; i--) { // focus is first
        let a = env.shapes[TWIST][i]
        a.cx = 5 + a.findex * 20
        a.cy = 400 - a.first.y * 30
        a.colour = a.first.hash.slice(2, 8)
    }
    return env
}


function end_timer(env) {
    env.time.end = performance.now()
    return env
}



function render_svg(env) {
    let svgs = '', edgestr = '', edges = []
    env.shapes[TWIST].forEach(a => {
        svgs += `<circle cx="${a.cx}" cy="${a.cy}" r="5" fill="#${a.colour}" id="${a.hash}" />`
        if(a.prev)
            edges.push([a, a.prev, 'prev'])
        if(a.teth)
            edges.push([a, a.teth, 'teth'])
        if(a.body.posts.length)
            a.body.posts.forEach(e => edges.push([a, e, 'post']))
        if(a.body.hoists.length)
            a.body.hoists.forEach(e => {
                edges.push([a, e[0], 'lead'])
                edges.push([a, e[1], 'meet'])
            })
    })
    edges.forEach(e => {
        let fx = e[0].cx, fy = e[0].cy, tx = e[1].cx, ty = e[1].cy
        edgestr += `<path d="M ${fx} ${fy} ${tx} ${ty}" fill="none" class="${e[2]}"/>`
    })
    vp.innerHTML = '<g id="gtag">' + edgestr + svgs + '</g>'
    return env
}

function write_stats(env) {
    el('stats').innerHTML =
    `<p>Analyzed ${env.buff.byteLength.toLocaleString()} bytes
        containing ${env.atoms.length.toLocaleString()} atoms
        with ${env.dupes.length.toLocaleString()} duplicates
        in ${(env.time.end-env.time.start).toFixed(0)}ms.</p>
     <p>There are ${env.shapes[TWIST].length.toLocaleString()} twists,
        ${env.shapes[BODY].length.toLocaleString()} bodies
        ...
        and ${env.errors.length.toLocaleString()} errors.
    </p>`
    return env
}

function probe(env) {
    console.log(env)
    e = env
}

// DOM things

function show_node(id) {
    let node = e.index[id]
    if(!node) return 0
    ;[...document.querySelectorAll('.select')].map(n => n.classList.remove('select'))
    el(id).classList.add('select')
    let json = `<pre>${JSON.stringify(node, (k, v) => k ? (v.hash ? v.hash : v) : v, 2)}</pre>`
    el('node').innerHTML = json.replaceAll(/"(41.*?)"/g, '"<a href="" onmouseover="highlight_node(\'$1\')" onclick="show_node(\'$1\');return false;">$1</a>"')
}

function highlight_node(id) {
    ;[...document.querySelectorAll('.highlight')].map(n => n.classList.remove('highlight'))
    el(id)?.classList?.add('highlight')
}


// helpers

let hexes = hexes_helper()
function hexes_helper() {
    return Array.from(Array(256)).map((n,i)=>i.toString(16).padStart(2, '0'))
}

function pluck_hex(b, s, l) {     // requires hexes helper
    let hex = ''
    let uints = new Uint8Array(b, s, l) // OPT: 72ms
    for(i=0; i<l; i++) // OPT: 53ms
        hex += hexes[uints[i]] // OPT: 144ms
    return hex
}

function pluck_hash(b, s) {
    let l = 0, ha = pluck_hex(b, s, 1)
    if(ha === '41')
        l = 32
    else
        return 0
    return ha + pluck_hex(b, s + 1, l)
}

function pluck_length(b, s) {
    // 32 bit int... bigendian? need to specify this in the rig spec
    let v = new DataView(b, s, 4)
    return v.getUint32()
}

function leng(h) {
    return h ? h.length/2 : 1
}

function pairtrier(h, env) {
    let trie = env.index[h]
    if(!trie) return 0
    if(trie.shape !== '63') return 0
    trie.pairs = []
    for(let i = trie.bin.cfirst; i < trie.bin.last;) {
        let k = pluck_hash(env.buff, i)
        i += leng(k)
        let v = pluck_hash(env.buff, i)
        i += leng(v)
        trie.pairs.push([k, v])
    }
    return trie
}

function fastprev(twist) {
    if(!twist.prev) return 0
    if(twist.prev.teth)
        return twist.prev
    return fastprev(twist.prev)
}

function wrap(inn, f, out) {
    return env => {
        let val = f(env[inn])
        let w = v => (env[out] = v) && env
        return val.constructor === Promise
             ? val.then(w) // (v => w(v))            // fun made a promise
             : w(val)
    }
    // TODO: does this work for setTimeout and requestAnimationFrame? need to return a promise even if it didn't make one
    // TODO: what if there's no out?
}

function pipe(...all_funs) {
  function magic_pipe(env={}) {
    let fun, pc=0, funs = [...all_funs]

    function inner() {
      fun = funs[pc++]
      if(!fun) return 0

      if(fun.async)                     // fun is async (non-promise)
        return new Promise(f => fun.async(env, f)).then(cb)

      return cb(fun(env))               // fun is sync
    }

    function cb(new_env) {
      env = new_env                     // does something

      if(env && env.constructor === Promise)
        return env.then(cb)            // fun made a promise

      return inner()
    }

    return cb(env)
  }

  return magic_pipe
}