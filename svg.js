//
// TODA file view tool
//

// TODO:
// show highlight in sidebar
// upload file (or pick an example?)
// emoji/hex
// later:
// highlight hitches
// hash check
// shape check
// sig check
// hitch check
// rig check
// make multi-successors a different size? (or a red ring?)
// list errors



const TWIST = 48
const BODY  = 49
const el = document.getElementById.bind(document)
const vp = el('viewport')

let showpipe = pipe( wrap('name', import_file, 'buff')
                   , start_timer
                   , buff_to_rough
                   , untwist_bodies
                   , twist_list
                   , have_successors
                   , get_hitched
                   , get_in_line
                   , stack_lines
                   , scooch_twists
                   , end_timer
                   , render_svg
                   , write_stats
                   , probe
                   , setenv
                   , select_focus
                   )

showpipe()

function import_file(env) {
    return fetch('plain.toda')
    // return fetch('super.toda')
    // return fetch('mega.toda')
          .then(res => res.arrayBuffer())
          .catch(err => console.log('oops')) // stop trying to make fetch happen
}

function start_timer(env) {
    env.time = {start: performance.now()}
    return env
}

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
            return env                       // oh no buff is hopeless
        }
        i += hash.length/2
        let pfirst = i

        let shape = pluck_hex(b, i++, 1)

        let length = pluck_length(b, i)
        i += 4 + length

        // set values
        let atom = {shape, hash, bin: {length, afirst, pfirst, cfirst: pfirst+5, last: i-1}}
        if(env.index[hash]) {                // OPT: this takes 300ms w/ 10k atoms (1M dupes) -- but 500ms w/ Map
            env.dupes.push(atom)
            continue
        }
        env.atoms.push(atom)
        env.index[hash] = atom
        ;(env.shapes[shape]||=[]).push(atom) // shapes on demand
    }

    return env
}

function untwist_bodies(env) {
    env.shapes[BODY].forEach(a => {          // reverse twister all six body parts
        let i = a.bin.cfirst
        let p = pluck_hash(env.buff, i)      // order is important
        a.prev = env.index[p] || 0           // objectify prev
        let t = pluck_hash(env.buff, (i += leng(p)))
        a.teth = env.index[t] || 0           // objectify teth
        a.shld = pluck_hash(env.buff, (i += leng(t)))
        a.reqs = pluck_hash(env.buff, (i += leng(a.shld)))
        a.rigs = pluck_hash(env.buff, (i += leng(a.reqs)))
        a.carg = pluck_hash(env.buff, (i += leng(a.rigs)))
        a.hoisting = []                      // for consistency
        a.posts  = []
        a.rigtrie = pairtrier(a.rigs, env)   // trieify rigs
    })
    return env
}

function twist_list(env) {
    env.shapes[TWIST].forEach(a => {
        let b = pluck_hash(env.buff, a.bin.cfirst)
        a.body = env.index[b] || 0
        if(!a.body)                          // that's going to leave a mark
            return 0
        a.prev = a.body.prev                 // conveniences
        a.teth = a.body.teth
        a.hoisting = a.body.hoisting
        a.posts = a.body.posts
        a.succ = []
        a.body.twist = a                     // HACK: could be multiples
    })
    return env
}

function have_successors(env) {
    env.shapes[TWIST].forEach(a => {         // seperate phase so everything will .succ
        if(!a.prev) return 0
        a.prev.succ.push(a)                  // HACK: doesn't check legitimacy
    })
    return env
}

function get_hitched(env) {
    env.shapes[BODY].forEach(a => {          // slurps out connections. cheats a lot.
        if(!a.rigtrie) return 0
        a.rigtrie.pairs.forEach(pair => {
            let meet = env.index[pair[1]]    // HACK: doesn't check hoist
            if(!meet) return 0
            if(env.index[pair[0]])
                return a.posts.push(meet)    // HACK: doesn't check post
            let lead = fastprev(meet)
            a.hoisting.push([lead, meet])
            lead.leadhoist = a.twist         // in edges for up direction
            meet.meethoist = a.twist
        })
    })
    return env
}

function get_in_line(env) {
    env.firsts = []
    env.shapes[TWIST].forEach(a => {
        [a.first, a.findex] = get_first(a)
        if(!a.findex)
            env.firsts.push(a)               // a DAG root in this bag of atoms
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

function stack_lines(env) {                  // one-pass line aligner, B- for spools
    env.firsts.forEach((t,i) => t.y = i+1.5) // .5 for the atrocious ordering hack
    env.firsts.forEach((t,i) => {
        let min_tether = env.shapes[TWIST].filter(a=>a.first === t)
                            .reduce((acc, a) => Math.min(acc, a.teth?.first?.y||Infinity), Infinity)
        if(min_tether < t.y)                 // move lines under their lowest tether
            t.y = +((min_tether + "").slice(0,-1) + "0" + (i+1))
    })
    env.firsts.sort((a,b) => a.y - b.y).forEach((t,i) => t.y = i)
    return env
}

function scooch_twists(env) {
    for(let i=env.firsts.length-1; i>=0; i--) {
        let t = env.firsts[i]                // start at the top
        while(t) {
            let tethx = t.teth?.x || 0       // these profligate defaults are grating
            let postx = t.post?.x || 0
            let leadx = t.leadhoist?.x || 0
            let right = Math.max(tethx, postx)
            if(leadx && right)               // grating and flawed
                t.x = (leadx - right) / 2 + right
            else if(right)
                t.x = right + 10
            else if(leadx)
                t.x = leadx - 10
            else
                t.x = t.findex * 20

            if(t.x < t.prev?.x)
                t.x = t.prev.x + 20          // FIXME: breaks the leadx invariant

            t.cx = 5 + t.x
            t.cy = 400 - t.first.y * 30
            t.colour = t.first.hash.slice(2, 8)
            t = t.succ[0]
        }
        // TODO: set the xs deterministically, track the closest pair, and if there's too much overlap set a global that forces everything further apart... (even this might not be enough though, if there's jumps between levels -- may need up pressure)
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
        if(a.body.hoisting.length)
            a.body.hoisting.forEach(e => {
                edges.push([a, e[0], 'lead'])
                edges.push([a, e[1], 'meet'])
            })
    })
    edges.reverse().forEach(e => {           // prev and teth at back for style
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

function select_focus(env) {
    let focus = env.shapes[TWIST][env.shapes[TWIST].length-1]
    el(focus.hash).classList.add('focus')
    select_node(focus.hash)
    return env
}

function probe(env) {
    console.log(env)
    return env
}

function setenv(x) {
    env = x                                  // make a global for DOM consumption
    return env                               // ^ kind of a hack but pipe is async
}

// DOM things

vp.addEventListener('wheel', e => {
    let dy = (201+Math.max(-200, Math.min(200, e.deltaY)))/200
    if((dy < 1 && vp.currentScale < 0.002) || (dy > 1 && vp.currentScale > 200)) return false
    vp.currentScale *= dy
    vp.currentTranslate.y = vp.currentTranslate.y * dy + vp.clientWidth * (1 - dy)
    vp.currentTranslate.x = vp.currentTranslate.x * dy + vp.clientHeight * (1 - dy)
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
        vp.currentTranslate.x += e.movementX * 3
        vp.currentTranslate.y += e.movementY * 3
    }
})

window.addEventListener('keydown', e => {
    let key = e.keyCode, id = document.getElementsByClassName('select')[0]?.id
    let t = env.index[id]                    // uses global env
    if(!id || !t) return 0
    if(key === 38)                           // up up
        select_node(t.meethoist?.hash || t.leadhoist?.hash || t.posts[0]?.hash)
    if(key === 40)                           // down down
        select_node(t.hoisting[0]?.[0]?.hash)
    if(key === 37)                           // left right
        select_node(t.prev.hash)
    if(key === 39)                           // left right
        select_node(t.succ[0]?.hash)
})

function select_node(id) {
    let t = env.index[id], dom = el(id)      // uses global env
    if(!t || !dom) return 0
    ;[...document.querySelectorAll('.select')].map(n => n.classList.remove('select'))
    dom.classList.add('select')
    let html = `<pre>${JSON.stringify(t, (k, v) => k ? (v.hash ? v.hash : v) : v, 2)}</pre>`
    el('node').innerHTML = html.replaceAll(/"(41.*?)"/g, '"<a href="" onmouseover="highlight_node(\'$1\')" onclick="select_node(\'$1\');return false;">$1</a>"')
    scroll_to(t.cx, t.cy)
}

function highlight_node(id) {
    ;[...document.querySelectorAll('.highlight')].map(n => n.classList.remove('highlight'))
    el(id)?.classList?.add('highlight')
}

function scroll_to(x, y) {
    let MAGIC_CONSTANT = -2.2                // ¯\_(ツ)_/¯
    vp.currentTranslate.x = MAGIC_CONSTANT * x * vp.currentScale + vp.clientWidth
    vp.currentTranslate.y = MAGIC_CONSTANT * y * vp.currentScale + vp.clientHeight
}

// helpers

let hexes = hexes_helper()
function hexes_helper() {
    return Array.from(Array(256)).map((n,i)=>i.toString(16).padStart(2, '0'))
}

function pluck_hex(b, s, l) {                // requires hexes helper
    let hex = ''
    let uints = new Uint8Array(b, s, l)      // OPT: 72ms
    for(i=0; i<l; i++)                       // OPT: 53ms
        hex += hexes[uints[i]]               // OPT: 144ms
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
    let v = new DataView(b, s, 4)            // 32 bit bigendian int
    return v.getUint32()
}

function leng(h) {
    return h ? h.length/2 : 1                // byte length from hex or 0
}

function pairtrier(h, env) {
    let trie = env.index[h]
    if(!trie) return 0
    if(trie.shape !== '63') return 0         // don't try to trie a non-trie tree
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
        let val = f(env[inn])                // TODO: cope without inn&out
        let w = v => (env[out] = v) && env
        return val.constructor === Promise
             ? val.then(w)                   // fun made a promise
             : w(val)                        // TODO: promise back y'all
    }
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