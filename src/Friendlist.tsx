import React, { useRef, useCallback, useState, useMemo } from 'react'
import './App.css'
import {
    Event,
    nip19,
} from 'nostr-tools'

import { Tag } from './Tags'

export const FriendBox: React.FC<{ friendlist: Event, set_friendlist: React.Dispatch<React.SetStateAction<Event>>, publish: (e: Event) => void, fetch_friendlist: (p: string, since?: number) => void, reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>> }> = ({
    friendlist,
    set_friendlist,
    fetch_friendlist,
    set_reply_tags,
    reply_tags,
}) => {
    const [hidden, set_hidden] = useState(true)
    const [deletebox, set_deletebox] = useState(false)
    const tags = useRef([] as string[][])
    const hide = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        set_hidden((hidden) => !hidden)
    }, [])
    const pushOnClick = useCallback((tag: string[]) => {
        return (e: React.MouseEvent) => {
            e.preventDefault()
            set_reply_tags((reply_tags) => {
                let b: boolean = false
                for (let i in reply_tags) {
                    if (reply_tags[i][1] === tag[1]) {
                        b = true
                        break
                    }
                }
                return b ? reply_tags : [...reply_tags, tag]
            })
        }
    }, [])
    const addOnClick = useCallback((tag: string[]) => {
        return (e: React.MouseEvent) => {
            e.preventDefault();
            for (let i in tags.current) {
                if (tags.current[i][1] === tag[1]) {
                    return
                }
            }
            tags.current.push([tag[0], tag[1], "" as string, "" as string])
            window.nostr.getPublicKey().then((p) => {
                let e = generateNewEvent(p)
                // console.log(JSON.stringify(e))
                localStorage.setItem(p, JSON.stringify(e))
                set_friendlist(() => e)
                tags.current = [] as string[][]
            })
        }
    }, [friendlist])
    const removePub = useCallback((pub: string) => {
        let new_tags = [] as string[][]
        for (let i in friendlist.tags) {
            if (friendlist.tags[i][1] !== pub) {
                new_tags.push(friendlist.tags[i])
            }
        }
        if (new_tags.length === friendlist.tags.length) {
            return
        }
        let content = friendlist.content
        window.nostr.getPublicKey().then((p) => {
            let event: Event = {
                kind: 3,
                created_at: Math.floor(Date.now() / 1000),
                tags: new_tags,
                content: content,
                pubkey: p,
            }
            localStorage.setItem(p, JSON.stringify(event))
            set_friendlist(() => event)
        })
    }, [friendlist])
    const generateNewEvent = useCallback((p: string) => {
        let new_tags = [...friendlist.tags] as string[][]
        let content = friendlist.content
        for (let i in tags.current) {
            let t = tags.current[i]
            let b = false
            for (let j in new_tags) {
                if (t[1] == new_tags[j][1]) {
                    new_tags[j][2] = (new_tags[j][2] !== undefined) ? new_tags[j][2] : ""
                    new_tags[j][3] = t[3]
                    b = true
                    break
                }
            }
            if (!b) {
                new_tags.push(t)
            }
        }
        let event: Event = {
            kind: 3,
            created_at: Math.floor(Date.now() / 1000),
            tags: new_tags,
            content: content,
            pubkey: p,
        }
        return event
    }, [friendlist])
    let handleTagChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        let arr = e.target.name.split(" ")
        let [id, url] = [arr[0], arr[1]]
        if ((id === undefined) || (url === undefined)) {
            console.log("panic: error parsing friendlist entry")
            return
        }
        for (let i in tags.current) {
            if (tags.current[i][1] == id) {
                tags.current[i][3] = e.target.value
                return
            }
        }
        tags.current.push(["p", id, url, e.target.value])
    }, [])
    let save = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        window.nostr.getPublicKey().then((p) => {
            let ev = generateNewEvent(p)
            if (ev !== undefined) {
                localStorage.setItem(p, JSON.stringify(ev))
                set_friendlist(() => ev)
                tags.current = [] as string[][]
            } else {
                console.log("error")
            }
        })
    }, [friendlist])
    let fetchOnClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        window.nostr.getPublicKey().then((p) => {
            fetch_friendlist(p, friendlist.created_at)
        })
    }, [friendlist])
    //get the ptags which are not already in the friendlist
    let ptags = useMemo(() => {
        let ret_tags = [] as string[][]
        outer:
        for (let i in reply_tags) {
            let rt = reply_tags[i]
            if (rt[0] !== "p") {
                continue
            }
            for (let j in friendlist.tags) {
                if (rt[1] === friendlist.tags[j][1]) {
                    continue outer
                }
            }
            ret_tags.push(rt)
        }
        return ret_tags
    }, [friendlist, reply_tags])
    let mainBody = useMemo(() =>
        friendlist.created_at !== undefined ? <>
            <div className="topsig">
                <a className="hide" onClick={hide}>Friendlist</a>
                {!hidden && <><a onClick={fetchOnClick}>fetch</a><a onClick={save}> save</a></>}
                <span className="gray">Last Updated: {(new Date((friendlist.created_at as number) * 1000)).toLocaleTimeString('en-US', { "hourCycle": "h23", "weekday": "short", "month": "short", "day": "2-digit" })}</span>
            </div>
            {!hidden && <div className="friendlist">
                {
                    friendlist.tags.map(
                        (tag, _) => <div
                            className="frienditem" key={tag[1]}>
                            <a href={"https://www.nostr.guru/" + nip19.npubEncode(tag[1])}
                                draggable={true}
                                onDragStart={(e) => { e.dataTransfer.setData("pub", tag[1]); set_deletebox(() => true) }}
                                onDragEnd={() => set_deletebox(() => false)}
                                onContextMenu={() => {}}
                                onClick={pushOnClick([tag[0], tag[1]])}
                            >{nip19.npubEncode(tag[1]).substring(0, 12)}
                            </a>
                            <input name={tag[1] + " " + tag[2]} defaultValue={tag[3]} maxLength={12} spellCheck={false} onChange={handleTagChange}></input>
                        </div>)
                }
            </div>}
        </> : <></>
        , [friendlist, hidden])
    return (friendlist.created_at !== undefined ? <div className="friendbox" >
        {mainBody}
        {deletebox && <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => removePub(e.dataTransfer.getData("pub"))} className="consideration" > Delete?</div>}
        {(!hidden && ptags.length > 0) && <div className="consideration">{ptags.map((tag, i) => <Tag tag={tag} onContextMenu={() => {}} friendlist={friendlist} onClick={addOnClick(tag)} key={i} />)}</div>}
    </div> : <></>)
}
