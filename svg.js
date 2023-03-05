const TWIST = 48
const BODY  = 49
const el = document.getElementById.bind(document)
const vp = el('viewport')
el('up'   ).addEventListener('click', e => vp.currentTranslate.y -= 30)
el('down' ).addEventListener('click', e => vp.currentTranslate.y += 30)
el('left' ).addEventListener('click', e => vp.currentTranslate.x -= 30)
el('right').addEventListener('click', e => vp.currentTranslate.x += 30)
el('in' ).addEventListener('click', e => vp.currentScale *= 1.1)
el('out').addEventListener('click', e => vp.currentScale /= 1.1)

let showpipe = pipe( wrap('name', import_file, 'buff')
                //    , buff_to_uints
                   , buff_to_rough
                   , untwist_bodies
                   , twist_list
                   , have_successors
                   , get_in_line
                   , stack_lines
                   , position_atoms
                   , render_svg
                   , probe
                   )

showpipe()



// hash check for atoms
// packet inflation
// length check
// shape check
// link twists
// layout lines
// render
// add some mouseover for showing details
// highlight hitches
// show rig errors



// import binary
// TODO: probably just feed the raw buffer into this pipeline instead
function import_file(env) {
    // return fetch('test/client/files/82e47590-7eb4-4c14-8060-57106643088b/41c3cdc16cef90ace781bcb0f7328611aa14b11d450153be0b134ec8b2706b698c.toda')
    // return fetch('files/41dcb551415a12cfb6aec7148ce4cd21a20c4398624b0bfd7e03c265ba3a0f145b.toda')
    // return fetch('super.toda')
    return fetch('mega.toda')
           .then(res => res.arrayBuffer())
}

function buff_to_uints(env) {
    env.uints = [...new Uint8Array(env.buff)]
    return env
}

// binary buffer to rough atoms
function buff_to_rough(env) {
    let i = 0, b = env.buff, lb = b.byteLength
    env.atoms = []
    env.dupes = []
    env.index = {}
    // env.index = new Map
    env.shapes = {}
    env.errors = []

    while(i < lb) {
        // read hash
        let afirst = i
        let hash = pluck_hash(b, i)
        if(!hash) {
            env.errors.push({afirst, message: "Improper atom"})
            return env // stop trying to process buff
        }
        i += hash.length/2
        let pfirst = i

        // read shape
        let shape = pluck_hex(b, i++, 1)

        // read length
        let length = pluck_length(b, i)
        i += 4 + length

        // set values
        let atom = {shape, hash, bin: {length, afirst, pfirst, cfirst: pfirst+5, last: i-1}}
        if(env.index[hash]) { // OPT: profiler says this is slow (300ms) when there's 1M atoms... but it's 500ms w/ Map :/
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
        let p = pluck_hash(env.buff, a.bin.cfirst)
        a.prev = env.index[p] || 0
        let t = pluck_hash(env.buff, a.bin.cfirst + (p ? p.length/2 : 1))
        a.teth = env.index[t] || 0
    })
    return env
}

function twist_list(env) {
    env.shapes[TWIST].forEach(a => {
        let b = pluck_hash(env.buff, a.bin.cfirst)
        a.body = env.index[b] || 0
        if(!a.body)
            return 0
        a.prev = a.body.prev
        a.teth = a.body.teth
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
    env.lines = {}
    env.shapes[TWIST].forEach(a => {
        [a.first, a.findex] = get_first(a)
        if(!a.findex)
            env.lines[a.first.hash] = {first: a.first} // , max_length: 1}
    })
    return env
}

function get_first(a) {
    if (!a.prev)
        return [a, 0]
    else if (a.prev.first)
        return [a.prev.first, a.prev.findex + 1]
    else
        return get_first(a.prev)
}

function stack_lines(env) {
    let top = 0
    for(let i = env.shapes[TWIST].length-1; i >= 0; i--) { // focus is first
        let a = env.shapes[TWIST][i]
        if(!env.lines[a.first.hash].yi)
            env.lines[a.first.hash].yi = ++top
        if(a.teth && !env.lines[a.teth?.first?.hash]?.yi)
            env.lines[a.first.hash].yi = ++top
    }
    return env
}

function position_atoms(env) {
    for(let i = env.shapes[TWIST].length-1; i >= 0; i--) { // focus is first
        let a = env.shapes[TWIST][i]
        a.cx = 5 + a.findex * 5
        a.cy = 400 - env.lines[a.first.hash].yi * 10
        a.colour = a.first.hash.slice(2, 8)
    }
    return env
}


// focus line should be lowest
// make multi-successors a different size? (or a red ring?)
// parse riggings tries
// cheat on hoists by matching the meet and assuming the lead
// posts match on both
// topo sort by tethers (and hoists and posts)
// let long lines run off the edge, add a zoom component
// add the info box off to the size


function render_svg(env) {
    let svgs = '', edges = []
    env.shapes[TWIST].forEach(a => {
        svgs += `<circle cx="${a.cx}" cy="${a.cy}" r="1.5" fill="#${a.colour}" id="${a.hash}" />`
        if(a.prev)
            edges.push([a, a.prev])
        if(a.teth)
            edges.push([a, a.teth])
    })
    edges.forEach(e => {
        let fx = e[0].cx, fy = e[0].cy, tx = e[1].cx, ty = e[1].cy
        svgs += `<path d="M ${fx} ${fy} ${tx} ${ty}" fill="none" stroke="#456"/>`
    })
    vp.innerHTML = '<g id="gtag">' + svgs + '</g>'
    return env
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


function probe(env) {
    console.log(env)
    e = env
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