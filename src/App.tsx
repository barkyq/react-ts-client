import { useState, useRef, useCallback } from 'react'
import './App.css'
import {
    Event,
    relayInit,
    Filter,
    Relay,
    Kind,
} from 'nostr-tools'

import { Subscription, SubInfo, SubBox } from './Subscriptions'
import { Tag, Tags } from './Tags'
import { FriendBox } from './Friendlist'
import { Post } from './Post'
import { MainTextArea, prepare_content } from './Publish'
import { RelayHintBox } from './RelayHints'

declare global {
    interface Window {
        nostr: Nostr;
    }
}

interface Nostr {
    getPublicKey: () => Promise<any>,
    signEvent: (event: Event) => Promise<Event>,
    getRelays: () => Promise<{ [url: string]: { read: boolean, write: boolean } }>,
}

export const sort_Events = (evs: Event[]) => {
    let evs_copy = [...evs]
    evs_copy.sort((a: Event, b: Event) => b.created_at - a.created_at)
    return evs_copy
}

function App() {
    const eose = useRef(false)
    const ids_exist_ref = useRef([] as string[])
    const [seen_conn, set_seen_conn] = useState([] as string[])
    const [reply_tags, set_reply_tags] = useState<string[][]>([])

    const [disps, set_disps] = useState<Event[]>([])

    const [pk, set_pk] = useState('' as string)
    const [url, set_url] = useState('' as string)
    const r = useRef({ status: WebSocket.CLOSED } as Relay)
    const [connected, set_connected] = useState(false)
    const [subs, set_subs] = useState([] as Subscription[])
    const [friendlist, set_friendlist] = useState({ tags: [] as string[][] } as Event)
    const pubkeyConnect = useCallback(() => {
        const pk_cb = (p: string) => {
            set_pk(() => p)
            let stored_url = localStorage.getItem(p + "url")
            stored_url !== null && set_url(() => stored_url as string)

            let stored_friendlist = localStorage.getItem(p)
            if (stored_friendlist !== null) {
                let ev: Event = JSON.parse(stored_friendlist as string)
                set_friendlist(() => ev)
            } else {
                let ev: Event = {
                    pubkey: p,
                    kind: 3 as Kind,
                    content: "",
                    tags: [] as string[][],
                    created_at: 0
                }
                set_friendlist(() => ev)
            }
        }
        window.nostr.getPublicKey().then(pk_cb).catch(() => {})
    }, [])

    const subscribe = useCallback((pk: string) => {
        let temp_string = localStorage.getItem(pk + "time")
        set_subs(() => [])
        let temp = (temp_string === null || isNaN(Number(temp_string))) ? Math.floor(Date.now() / 1000) : Number(temp_string)
        let filters: Filter[] = [
            {
                authors: [pk],
                kinds: [1],
                since: temp,
            }, {
                "#p": [pk],
                kinds: [1],
                since: temp,
            }
        ]
        if ((r.current.status == WebSocket.OPEN) && pk.length == 64) {
            let sub = r.current.sub(filters)
            sub.on('eose', () => {
                localStorage.setItem(pk + "time", Math.floor(Date.now() / 1000).toString())
                set_disps((arr: Event[]) => sort_Events(arr))
                eose.current = true
            })
            sub.on('event', (e: Event) => {
                let b: boolean = false
                set_seen_conn((sc) => {
                    for (let j in sc) {
                        if (sc[j] === e.id) {
                            return sc
                        }
                    }
                    return [...sc, e.id as string]
                })
                for (let i in ids_exist_ref.current) {
                    if (ids_exist_ref.current[i] === e.id) {
                        b = true
                        break
                    }
                }
                if (!b) {
                    ids_exist_ref.current.push(e.id as string)
                    if (eose.current) {
                        set_disps((arr: Event[]) => [e, ...arr])
                    } else {
                        set_disps((arr: Event[]) => [...arr, e])
                    }
                }
            })
            set_subs(subs => [{ underlying: sub, filters: filters }, ...subs])
        }
    }, [pk])

    const relayConnect = useCallback(() => {
        if (r.current.status !== WebSocket.CLOSED) {
            r.current.close().then(() => {})
        }
        r.current = relayInit(url)
        const connect_cb = () => {
            console.log("connect")
            set_connected(() => true)
            localStorage.setItem(pk + "url", url)
            subscribe(pk)
        }
        const error_cb = () => {
            console.log("error")
            set_connected(() => false)
        }
        const disconnect_cb = () => {
            console.log("disconnected")
            set_connected(() => false)
        }
        const after_connect_relay = () => {
            r.current.on('connect', connect_cb)
            r.current.on('error', error_cb)
            r.current.on('disconnect', disconnect_cb)
            r.current.on('notice', console.log)
        }
        r.current.connect().then(after_connect_relay).catch(() => {});
    }, [url, pk]);
    const publish_raw = useCallback((cb: () => void) => {
        return (e: Event) => {
            if (r.current.status == WebSocket.OPEN) {
                let p = r.current.publish(e)
                p.on('ok', cb)
                p.on('failed', () => {})
            }
        }
    }, [])

    const fetch_friendlist = useCallback((p: string, since?: number) => {
        if (r.current.status == WebSocket.OPEN) {
            let filters = [{
                authors: [p],
                kinds: [3],
                since: since
            }] as Filter[]
            let sub = r.current.sub(filters)
            let returned_events: Event[] = []
            sub.on('event', (e: Event) => {
                returned_events.push(e)
            })
            sub.on('eose', () => {
                sub.unsub()
                console.log(returned_events)
                if (returned_events.length > 0) {
                    set_friendlist(() => sort_Events(returned_events)[0])
                }
            })
        }
    }, [])

    const publish = useCallback((content: string, reply_tags: string[][], cb: () => void) => {
        let event = prepare_content(content, reply_tags, pk)
        localStorage.setItem(pk + "time", Math.floor(Date.now() / 1000).toString())
        window.nostr.signEvent(event).then((e) => publish_raw(() => {
            set_seen_conn((sc) => {
                for (let j in sc) {
                    if (sc[j] === e.id) {
                        return sc
                    }
                }
                return [...sc, e.id as string]
            });
            cb();
        })(e)).catch(console.log)
    }, [])

    const stash = useCallback((content: string, reply_tags: string[][], cb: () => void) => {
        let event = prepare_content(content, reply_tags, pk)
        window.nostr.signEvent(event).then((e) => {
            for (let j in ids_exist_ref.current) {
                if (ids_exist_ref.current[j] === e.id) {
                    return
                }
            }
            ids_exist_ref.current.push(e.id as string);
            set_disps((disps) => [e, ...disps]);
            cb();
        }).catch(console.log)
    }, [])

    const fetch_e_tags = useCallback((reply_tags: string[][]) => {
        if (r.current.status !== WebSocket.OPEN) {
            return
        }
        let e_tags_unseen: string[] = []
        outer:
        for (let i in reply_tags) {
            let val = reply_tags[i][1]
            switch (reply_tags[i][0]) {
                case "e":
                    for (let j in ids_exist_ref.current) {
                        if (ids_exist_ref.current[j] === val) {
                            continue outer
                        }
                    }
                    e_tags_unseen.push(val)
                    break
                default:
            }
        }
        const filters: Filter[] = []

        if (e_tags_unseen.length > 0) {
            filters.push({
                ids: e_tags_unseen,
            })
        }
        fetch_filters_unsub_on_eose(filters)
    }, [])

    const fetch_filters_unsub_on_eose = useCallback((filters: Filter[]) => {
        if (filters.length > 0) {
            let sub = r.current.sub(filters)
            let returned_events: Event[] = []
            sub.on('eose', () => {
                sub.unsub()
                if (returned_events.length > 0) {
                    set_disps((arr: Event[]) => {
                        return sort_Events([...returned_events, ...arr])
                    })
                }
            })
            sub.on('event', (e: Event) => {
                set_seen_conn((sc) => {
                    for (let j in sc) {
                        if (sc[j] === e.id) {
                            return sc
                        }
                    }
                    return [...sc, e.id as string]
                })
                for (let j in ids_exist_ref.current) {
                    if (e.id === ids_exist_ref.current[j]) {
                        return
                    }
                }
                ids_exist_ref.current.push(e.id as string)
                returned_events.push(e)
            })
        }
    }, [])

    const fetch_p_tags = useCallback((update: SubInfo[], old_info: SubInfo[], cb: () => void) => {
        if (r.current.status !== WebSocket.OPEN) {
            console.log("ping")
            return
        }
        let filters: Filter[] = []
        for (let j in update) {
            let new_info = update[j]
            if (new_info.type !== "author") {
                continue
            }
            let since = new_info.since
            let until: number | undefined
            for (let i in old_info) {
                if (old_info[i].tag[1] === new_info.tag[1] && old_info[i].tag[0] === new_info.tag[0] && old_info[i].type === new_info.type) {
                    until = old_info[i].since
                }
            }
            if (until !== undefined && until < since) {
                continue
            }
            let f: Filter = { kinds: [1], authors: [new_info.tag[1]], since: since, until: until }
            filters.push(f)
        }
        if (filters.length > 0) {
            let sub = r.current.sub(filters)
            let returned_events: Event[] = []
            let eose: boolean = false
            sub.on('eose', () => {
                eose = true
                cb()
                set_subs((subs) => [{ underlying: sub, filters }, ...subs])
                if (returned_events.length > 0) {
                    set_disps((arr: Event[]) => {
                        return sort_Events([...returned_events, ...arr])
                    })
                }
            })
            sub.on('event', (e: Event) => {
                set_seen_conn((sc) => {
                    for (let j in sc) {
                        if (sc[j] === e.id) {
                            return sc
                        }
                    }
                    return [...sc, e.id as string]
                })
                for (let j in ids_exist_ref.current) {
                    if (e.id === ids_exist_ref.current[j]) {
                        return
                    }
                }
                ids_exist_ref.current.push(e.id as string)
                eose ? set_disps((arr: Event[]) => [e, ...arr]) : returned_events.push(e)
            })
        } else {
            cb()
        }
    }, [subs])

    return (
        <div className="App">
            <div className={"titlebar"}><span>react-ts-client</span></div>
            <div className="loginBox">
                {pk === "" && <a onClick={pubkeyConnect}>{"Connect to browser extension"}</a>}
                {pk !== "" && <>
                    <div>{connected ? <span className="hide" onClick={() => { r.current.close() }}>Connected to: {url}</span> : <form onSubmit={(e) => { e.preventDefault(); relayConnect() }}><button className="connect_button" type="submit">{"Connect to:"}</button><input value={url} autoFocus={false} onChange={(e) => set_url(() => { set_seen_conn(() => [] as string[]); return e.target.value })}></input></form>} </div>
                    <div><span className="gray">Logged in as:</span> <Tag tag={["p", pk]} friendlist={friendlist} onClick={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} /></div>
                </>}
            </div>
            {connected && <>
                <FriendBox friendlist={friendlist} set_friendlist={set_friendlist} publish={publish_raw(() => {})} fetch_friendlist={fetch_friendlist} reply_tags={reply_tags} set_reply_tags={set_reply_tags} />
                <SubBox friendlist={friendlist} fetcher={fetch_p_tags} subs={subs} set_reply_tags={set_reply_tags} reply_tags={reply_tags} />
                <RelayHintBox reply_tags={reply_tags} friendlist={friendlist} ids_exist_ref={ids_exist_ref} disps={disps} set_disps={set_disps} url={url} />
                <MainTextArea friendlist={friendlist} publish={publish} stash={stash} reply_tags={reply_tags} set_reply_tags={set_reply_tags} />
            </>
            }
            <div id="notelist">
                {(eose) &&
                    <>
                        {disps.map(
                            (e: Event) => <Post key={e.id} ev={e} reply_tags={reply_tags} set_reply_tags={set_reply_tags} set_disps={set_disps} pk={pk} friendlist={friendlist} fetcher={fetch_e_tags} publish={publish_raw(() => {
                                set_seen_conn((sc) => {
                                    for (let j in sc) {
                                        if (sc[j] === e.id) {
                                            return sc
                                        }
                                    }
                                    return [...sc, e.id as string]
                                })
                                for (let j in ids_exist_ref.current) {
                                    if (ids_exist_ref.current[j] === e.id) {
                                        return
                                    }
                                }
                                ids_exist_ref.current.push(e.id as string);
                                set_disps((disps) => [e, ...disps]);
                            })} seen_conn={seen_conn} />)
                        }
                    </>
                }
            </div>
            <div className="fetchBox">
                <div className="tagColumn">
                    <Tags reply_tags={reply_tags} set_reply_tags={set_reply_tags} friendlist={friendlist} />
                </div>
            </div>
        </div >
    )
}

export default App
