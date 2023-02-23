import React, { useRef, useMemo, useState } from 'react'
import './App.css'
import {
    Relay,
    Event,
    Filter,
    nip19, relayInit,
} from 'nostr-tools'

import { sort_Events } from './App'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const RelayHintBox: React.FC<{ reply_tags: string[][], friendlist: Event, ids_exist_ref: React.MutableRefObject<string[]>, disps: Event[], set_disps: React.Dispatch<React.SetStateAction<Event[]>>, url: string }> = ({
    reply_tags,
    friendlist,
    ids_exist_ref,
    disps,
    set_disps
}) => {
    const relcs = useRef([] as Relay[])
    const [hidden, set_hidden] = useState(true)
    const relays_loaded = useMemo(() => {
        let s = localStorage.getItem("relays")
        if (s === null) {
            return [] as string[][]
        } else {
            let r = [] as string[][]
            let t = s.split(',')
            for (let rl in t) {
                if (t[rl].match(/ws[s]*:\/\/[a-z0-9.\-_]*/) !== null) {
                    r.push([t[rl], "disconnected"])
                }
            }
            return r
        }
    }, [])
    const [relays, set_relays] = useState(relays_loaded)
    const relaybody = useMemo(() => {
        return relays.map((r, _) => <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                let eid = e.dataTransfer.getData("id")
                for (let i in ids_exist_ref.current) {
                    if (ids_exist_ref.current[i] === eid) {
                        return
                    }
                }
                for (let j in relcs.current) {
                    if (relcs.current[j].url === r[0]) {
                        let relc = relcs.current[j]
                        if (relc.status === WebSocket.OPEN) {
                            let filters = [] as Filter[]
                            filters.push({
                                ids: [eid],
                            })
                            let sub = relc.sub(filters)
                            sub.on('event', (ev: Event) => {
                                for (let i in ids_exist_ref.current) {
                                    if (ids_exist_ref.current[i] === eid) {
                                        return
                                    }
                                }
                                ids_exist_ref.current.push(eid)
                                set_disps((disps) => {
                                    return sort_Events([...disps, ev])
                                })
                            })
                            sub.on('eose', () => { sub.unsub() })
                        } else {
                            if (relc.status !== WebSocket.CLOSED) {
                                relc.close().then(() => {})
                            }
                            relcs.current.splice(Number(j), 1)
                            return
                        }
                    }
                }
                if (r[1] === "disconnected") {
                    var relc = relayInit(r[0])
                    relc.on('connect', () => {
                        set_relays((relays) => {
                            let new_relays = [...relays]
                            for (let j in relays) {
                                if (relays[j][0] === r[0]) {
                                    new_relays[j][1] = "connected"
                                }
                            }
                            return new_relays
                        })
                        if (relc.status === WebSocket.OPEN) {
                            let filters = [] as Filter[]
                            filters.push({
                                ids: [eid],
                            })
                            let sub = relc.sub(filters)
                            sub.on('event', (ev: Event) => {
                                for (let i in ids_exist_ref.current) {
                                    if (ids_exist_ref.current[i] === ev.id) {
                                        return
                                    }
                                }
                                console.log(ev)
                                ids_exist_ref.current.push(ev.id as string)
                                set_disps((disps) => {
                                    return sort_Events([...disps, ev])
                                })
                            })
                            sub.on('eose', () => { sub.unsub() })
                            return
                        }
                    })
                    relc.on('error', () => {
                        set_relays((relays) => {
                            let new_relays = [...relays]
                            for (let j in relays) {
                                if (relays[j][0] === r[0]) {
                                    new_relays[j][1] = "disconnected"
                                }
                            }
                            for (let j in relcs.current) {
                                if (relcs.current[j].url === relc.url) {
                                    relcs.current.splice(Number(j), 1)
                                }
                            }
                            if (relc.status !== WebSocket.CLOSED) {
                                relc.close().then(() => {})
                            }
                            return new_relays
                        })
                    })
                    relc.on('disconnect', () => {
                        set_relays((relays) => {
                            let new_relays = [...relays]
                            for (let j in relays) {
                                if (relays[j][0] === r[0]) {
                                    new_relays[j][1] = "disconnected"
                                }
                            }
                            for (let j in relcs.current) {
                                if (relcs.current[j].url === relc.url) {
                                    relcs.current.splice(Number(j), 1)
                                }
                            }
                            if (relc.status !== WebSocket.CLOSED) {
                                relc.close().then(() => {})
                            }
                            return new_relays
                        })
                    })
                    relc.connect().then(() => {});
                    relcs.current.push(relc)
                }
            }}
            key={r[0]} >
            <a className="reply" onClick={() => {
                set_relays((rels) => {
                    let new_relays = [...rels]
                    for (let j in rels) {
                        if (rels[j][0] === r[0]) {
                            new_relays.splice(Number(j), 1)
                            let just_names = [] as string[]
                            for (let j in new_relays) {
                                just_names.push(new_relays[j][0])
                            }
                            localStorage.setItem("relays", just_names.join(","))
                            return new_relays
                        }
                    }
                    return rels
                })
            }}> {r[0]}</ a>
            <span>{r[1]}</span>
        </div >)
    }, [relays])

    const mainbody = useMemo(() => {
        return reply_tags.map((tag, _) => {
            if (tag[0] !== 'e' || tag.length < 2 || tag[1].length !== 64) {
                return
            }
            var ClassName: string = "not_found"
            for (let d in ids_exist_ref.current) {
                if (ids_exist_ref.current[d] === tag[1]) {
                    ClassName = ""
                }
            }
            return <div key={tag[1]} >
                <a className={ClassName}
                    draggable={true}
                    onDragStart={(e) => { e.dataTransfer.setData("id", tag[1]); }}
                    onDragEnd={() => {}}
                    onContextMenu={() => {}}
                    onClick={(e) => { e.preventDefault() }}
                >{nip19.noteEncode(tag[1]).substring(0, 12)}
                </a>
                <>{tag[2].match(/ws[s]*:\/\/[a-z0-9.\-_]*/) !== null ? <a className="reply" onClick={() => set_relays((relays) => {
                    let just_names = [] as string[]
                    for (let j in relays) {
                        just_names.push(relays[j][0])
                        if (relays[j][0] === tag[2]) {
                            return relays
                        }
                    }
                    just_names.push(tag[2])
                    let new_relays = [...relays, [tag[2], "disconnected"]]
                    localStorage.setItem("relays", just_names.join(","))
                    return new_relays
                })}>
                    {tag[2]}
                </a> : <></>}</>
            </div >
        })
    }, [reply_tags, friendlist, disps])
    return (
        <div className="relayhints">
            <a className="hide" onClick={() => set_hidden((hidden) => !hidden)}> Relay hints</a>
            <div>
                {!hidden ? relaybody : <></>}
            </div>
            <div>
                {!hidden ? mainbody : <></>}
            </div>
        </div>)
}

