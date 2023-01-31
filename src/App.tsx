import React, { useState, useRef, useCallback, useMemo } from 'react'
import './App.css'
import {
    nip19,
    Event,
    relayInit,
    Filter,
    Relay,
    Sub,
    Kind,
} from 'nostr-tools'

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

interface Subscription {
    underlying: Sub,
    filters: Filter[],
}

const generate_reply_tags = (e: Event, pk: string, url: string) => {
    let reply_tags: string[][] = []
    if (e.pubkey !== pk) {
        reply_tags.push(["p", e.pubkey])
    }
    let has_root: boolean = false
    let has_e_tag: boolean = false
    let has_subject: boolean = false
    outer:
    for (let i in e.tags) {
        if (e.tags[i][0] === "subject" && !has_subject) {
            if (e.tags[i][1].substring(0, 4).search("^[R,r]e:") === -1) {
                reply_tags.push(["subject", "Re: " + e.tags[i][1]])
            } else {
                reply_tags.push(e.tags[i])
            }
        }
        for (let j in reply_tags) {
            if (reply_tags[j][0] == e.tags[i][0] && reply_tags[j][1] == e.tags[i][1]) {
                continue outer
            }
        }
        if ((e.tags[i][0] === "p") && (e.tags[i][1] !== pk) && (e.tags[i][1] !== e.pubkey)) {
            reply_tags.push(e.tags[i])
        }
        if (e.tags[i][0] === "e") {
            has_e_tag = true
        }
        if ((e.tags[i][0] === "e") && (e.tags[i][3] === "root") && !has_root) {
            reply_tags.push(e.tags[i])
            has_root = true
        }
    }
    // if has_e_tag should have a root...
    if ((has_e_tag) && (!has_root)) {
        for (let i in e.tags) {
            if (e.tags[i][0] === "e") {
                has_root = true
                if ((e.tags[i][2] !== null) && (e.tags[i][2] !== undefined)) {
                    reply_tags.push([e.tags[i][0], e.tags[i][1], e.tags[i][2], "root"])
                } else {
                    reply_tags.push([e.tags[i][0], e.tags[i][1], url, "root"])
                }
                break
            }
        }
    }
    if (has_root) {
        reply_tags.push(["e", (e.id as string), url, "reply"])
    } else {
        reply_tags.push(["e", (e.id as string), url, "root"])
    }
    return reply_tags
}

const Tag: React.FC<{ tag: string[], onClick: React.MouseEventHandler, onContextMenu: React.MouseEventHandler, friendlist: Event }> = ({
    tag,
    onClick,
    onContextMenu,
    friendlist
}) => {
    const [tag_name, bech32] = useMemo(() => {
        switch (tag[0]) {
            case "e":
                let note = nip19.noteEncode(tag[1])
                return [note.substring(0, 12), note]
            case "p":
                let npub = nip19.npubEncode(tag[1])
                for (let j in friendlist.tags) {
                    if (friendlist.tags[j][0] == "p" && friendlist.tags[j][3] !== undefined && friendlist.tags[j][3] !== "" && friendlist.tags[j][1] == tag[1]) {
                        return [friendlist.tags[j][3], npub]
                    }
                }
                return [npub.substring(0, 12), npub]
            default:
                return ["" as string, "" as string]
        }
    }, [tag, friendlist])
    switch (tag[0]) {
        case "p":
            return <a onClick={onClick} onContextMenu={onContextMenu} href={"nostr:" + bech32} > {tag_name}</a>
        case "e":
            var prefix: string
            switch (tag[3]) {
                case "root":
                    prefix = "root:"
                    break
                case "reply":
                    prefix = "re:"
                    break
                default:
                    prefix = "e:"
                    break
            }
            return <a onClick={onClick} onContextMenu={onContextMenu} href={"nostr:" + bech32} > {prefix + tag_name}</ a>
        default:
            return <></>
    }
}


const Tags: React.FC<{ reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, friendlist: Event }> = ({
    reply_tags,
    set_reply_tags,
    friendlist,
}) => {
    const removeOnClick = useCallback((key: number) => {
        return (e: React.MouseEvent) => {
            e.preventDefault()
            // use the updater!
            set_reply_tags((old_reply_tags) => {
                var new_tags: string[][] = []
                for (let i in old_reply_tags) {
                    if (Number(i) != key) {
                        new_tags.push(old_reply_tags[i])
                    }
                }
                return new_tags
            })
        }
    }, [])
    if (reply_tags.length === 0) {
        return <></>
    }
    return (
        <>
            {reply_tags.map(
                (tag: string[], i: number) => <Tag key={i} tag={tag} friendlist={friendlist} onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [tag]) }} onClick={removeOnClick(i)} />
            )}
        </>
    )
}

const sort_Events = (evs: Event[]) => {
    let evs_copy = [...evs]
    evs_copy.sort((a: Event, b: Event) => b.created_at - a.created_at)
    return evs_copy
}

interface SubInfo {
    type: string,
    tag: string[],
    since: number,
    active?: boolean
}

const SubBox: React.FC<{ subs: Subscription[], fetcher: (update: SubInfo[], old_info: SubInfo[], cb: () => void) => void, friendlist: Event, set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, reply_tags: string[][] }> = ({
    subs,
    fetcher,
    friendlist,
    reply_tags,
    set_reply_tags
}) => {
    const [hidden, set_hidden] = useState(false)
    const [update, set_update] = useState([] as SubInfo[])
    const subinfos = useMemo(() => {
        let subinfos = [] as SubInfo[]
        for (let i in subs) {
            for (let j in subs[i].filters) {
                let f = subs[i].filters[j]
                let since = f.since
                if (since == undefined) {
                    continue
                }
                outer:
                for (let k in f[`#p`]) {
                    for (let p in subinfos) {
                        if (subinfos[p].type !== "mention" ||
                            subinfos[p].tag[1] !== f[`#p`][Number(k)]) {
                            continue
                        }
                        if (subs[i].underlying !== undefined) {
                            subinfos[p].active = true
                        }
                        if (subinfos[p].since <= since) {
                            continue
                        }
                        subinfos[p].since = since
                        continue outer
                    }
                    subinfos.push({ type: "mention", tag: ["p", f[`#p`][Number(k)]], since: since, active: (subs[i].underlying !== undefined) } as SubInfo)
                }
                outer:
                for (let k in f.authors) {
                    for (let p in subinfos) {
                        if (subinfos[p].type !== "author" ||
                            subinfos[p].tag[1] !== f.authors[Number(k)]) {
                            continue
                        }
                        if (subs[i].underlying !== undefined) {
                            subinfos[p].active = true
                        }
                        if (subinfos[p].since <= since) {
                            continue outer
                        }
                        // update the since fields
                        subinfos[p].since = since
                        continue outer
                    }
                    subinfos.push({ type: "author", tag: ["p", f.authors[Number(k)]], since: since, active: (subs[i].underlying !== undefined) } as SubInfo)
                }
            }
        }
        return subinfos
    }, [subs])
    const mainbody = useMemo(() => {
        return subinfos.map((info, i) => {
            let since = info.since
            for (let j in update) {
                if (update[j].tag[1] === info.tag[1] && update[j].tag[0] === info.tag[0] && update[j].type === info.type) {
                    since = update[j].since
                }
            }
            return info.active !== undefined ? <div key={i}>
                <span>{info.type}</span>
                <Tag tag={info.tag} onClick={(e) => {
                    e.preventDefault(); set_reply_tags((current_tags) => {
                        for (let j in current_tags) {
                            if (current_tags[j][1] == info.tag[1] && current_tags[j][0] == info.tag[0]) {
                                return current_tags
                            }
                        }
                        return [...current_tags, info.tag]
                    })
                }} onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [info.tag]) }} friendlist={friendlist} />
                <MagicTimestamp key={info.tag[0] + info.tag[1]} info={info} setter={set_update} step={3600} since={since} />
            </div> : <></>
        })
    }, [friendlist, subs, update])
    const considers = useMemo(() => {
        let considers: SubInfo[] = []
        outer:
        for (let i in reply_tags) {
            let tag = reply_tags[i]
            if (tag[0] !== "p") {
                continue
            }
            for (let j in subinfos) {
                if (subinfos[j].type === "author" && subinfos[j].tag[1] === tag[1]) {
                    continue outer
                }
            }
            considers.push({ type: "author", since: NaN, tag: ["p", tag[1]], active: true })
        }
        return considers
    }, [reply_tags, subs])
    const consider_body = useMemo(() => {
        return considers.map((info, i) => {
            let since = info.since
            for (let j in update) {
                if (update[j].tag[1] === info.tag[1] && update[j].tag[0] === info.tag[0] && update[j].type === info.type) {
                    since = update[j].since
                }
            }
            return info.active !== undefined ? <div key={i}>
                <span>{info.type}</span>
                <Tag tag={info.tag} onClick={(e) => e.preventDefault()} onContextMenu={() => {}} friendlist={friendlist} />
                <MagicTimestamp key={info.tag[0] + info.tag[1]} info={info} setter={set_update} step={3600} since={since} />
            </div> : <></>
        })
    }, [reply_tags, subs, friendlist, update])
    return (<div className="sub">
        <div>
            <a className="hide" onClick={() => set_hidden((hidden) => !hidden)}> Subscriptions</a>
            {update.length > 0 && <a className="magictimestamp" onClick={() => fetcher(update, subinfos, () => { set_update(() => []) })}>submit</a>}
        </div>
        {!hidden ? consider_body : <></>}
        {!hidden ? mainbody : <></>}
    </div>)
}

const MagicTimestamp: React.FC<{ info: SubInfo, setter: React.Dispatch<React.SetStateAction<SubInfo[]>>, step: number, since: number }> = ({
    info,
    setter,
    step,
    since,
}) => {
    return <span className="magictimestamp"
        onClick={(e) => {
            e.preventDefault();
            setter((update) => {
                let new_update = [...update]
                for (let j in update) {
                    if (update[j].tag[1] === info.tag[1] && update[j].tag[0] === info.tag[0] && update[j].type === info.type) {
                        new_update.splice(Number(j), 1)
                        new_update.push({ type: info.type, tag: info.tag, since: update[j].since - step, active: true })
                        return new_update
                    }
                }
                new_update.push({ type: info.type, tag: info.tag, since: isNaN(info.since) ? Math.floor(Date.now() / 1000) : info.since - step, active: true })
                return new_update
            })
        }}
        onContextMenu={(e) => {
            e.preventDefault();
            setter((update) => {
                let new_update = [...update]
                for (let j in update) {
                    if (update[j].tag[1] === info.tag[1] && update[j].tag[0] === info.tag[0] && update[j].type === info.type) {
                        new_update.splice(Number(j), 1)
                        new_update.push({ type: info.type, tag: info.tag, since: update[j].since + step, active: true })
                        return new_update
                    }
                }
                new_update.push({ type: info.type, tag: info.tag, since: isNaN(info.since) ? Math.floor(Date.now() / 1000) : info.since + step, active: true })
                return new_update
            })
        }}>{!isNaN(since) ? "Since: " + (new Date((since as number) * 1000)).toLocaleTimeString('en-US', { "hourCycle": "h23", "weekday": "short", "month": "short", "day": "2-digit" }) : "Subscribe"}
    </ span >
}

const MainTextArea: React.FC<{ friendlist: Event, publish: (content: string, reply_tags: string[][], cb: () => void) => void, reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>> }> = ({
    friendlist,
    reply_tags,
    set_reply_tags,
    publish,
}) => {
    const [content, set_content] = useState('' as string)
    const [hidden, set_hidden] = useState(true)
    return (
        <div className="maintextarea">
            <div>
                {!hidden ? <textarea className="maintextarea" spellCheck="false" value={content} onChange={(e) => set_content(() => e.target.value)}></textarea> : <></>}
                {!hidden ? <div id="publish_button" onClick={() => { publish(content, reply_tags, () => set_content(() => "" as string)); }}>publish</div> : <></>}
                {<div id="hide_button" onClick={() => set_hidden((hidden) => !hidden)}>{hidden ? "expand" : "hide"}</div>}
            </div>
            {!hidden ? <div>
                <Tags reply_tags={reply_tags} set_reply_tags={set_reply_tags} friendlist={friendlist} />
            </div> : <></>}
        </div >
    )
}

const FriendBox: React.FC<{ friendlist: Event, set_friendlist: React.Dispatch<React.SetStateAction<Event>>, publish: (e: Event) => void, fetch_friendlist: (p: string, since?: number) => void, reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>> }> = ({
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
                window.nostr.signEvent(generateNewEvent(p)).then((e: Event) => {
                    // console.log(JSON.stringify(e))
                    localStorage.setItem(p, JSON.stringify(e))
                    set_friendlist(() => e)
                    tags.current = [] as string[][]
                })
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
            window.nostr.signEvent(event).then((e: Event) => {
                localStorage.setItem(p, JSON.stringify(e))
                set_friendlist(() => e)
            })
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
            window.nostr.signEvent(generateNewEvent(p)).then((ev: Event) => {
                if (ev !== undefined) {
                    localStorage.setItem(p, JSON.stringify(ev))
                    set_friendlist(() => ev)
                    tags.current = [] as string[][]
                } else {
                    console.log("error")
                }
            })
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
                {!hidden && <><a onClick={() => {}}>push</a><a onClick={fetchOnClick}>fetch</a><a onClick={save}> save</a></>}
                <span className="gray">Last Updated: {(new Date((friendlist.created_at as number) * 1000)).toLocaleTimeString('en-US', { "hourCycle": "h23", "weekday": "short", "month": "short", "day": "2-digit" })}</span>
            </div>
            {!hidden && <div className="friendlist">
                {
                    friendlist.tags.map(
                        (tag, i) => <div
                            className="frienditem" key={i}>
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

// need to useMemo to cache the output of various renderings
const Post: React.FC<{ ev: Event, reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, set_disps: React.Dispatch<React.SetStateAction<Event[]>>, relay_url: string, pk: string, friendlist: Event, fetcher: (tags: string[][]) => void }> = ({
    ev,
    reply_tags,
    set_reply_tags,
    set_disps,
    relay_url,
    pk,
    friendlist,
    fetcher }) => {
    const author_name = useMemo(() => {
        for (let j in friendlist.tags) {
            if (friendlist.tags[j][0] == "p" && friendlist.tags[j][3] !== undefined && friendlist.tags[j][3] !== "" && friendlist.tags[j][1] == ev.pubkey) {
                return friendlist.tags[j][3]
            }
        }
        return nip19.npubEncode(ev.pubkey)
    }, [ev, friendlist])
    const pushOnClick = useCallback((tag: string[]) => {
        return (e: React.MouseEvent) => {
            fetcher(ev.tags)
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
    const replyTagsOnClick = useCallback((e: React.MouseEvent) => {
        fetcher(ev.tags)
        e.preventDefault()
        let reply_tags = generate_reply_tags(ev, pk, relay_url)
        set_reply_tags(() => reply_tags)
    }, [ev, pk, relay_url])
    const hideOnClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        set_disps((curr: Event[]) => {
            let copy: Event[] = []
            for (let i in curr) {
                (curr[i].id !== ev.id) && copy.push(curr[i])
            }
            return copy
        })
    }, [ev])
    const tail = useMemo(() => {
        let elements: JSX.Element[] = []
        for (let j in ev.tags) {
            let tag = "#[" + j.toString() + "]"
            if ((ev.tags[j][0] === "e" || ev.tags[j][0] === "p") && (ev.content.indexOf(tag) === -1)) {
                var relay_string: string
                switch (ev.tags[j][2]) {
                    case undefined:
                        relay_string = relay_url
                        break
                    default:
                        relay_string = ev.tags[j][2]
                        break
                }
                switch (ev.tags[j][0]) {
                    case "p":
                        elements.push(<Tag key={j}
                            tag={ev.tags[j]}
                            onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [ev.tags[j]]) }}
                            friendlist={friendlist}
                            onClick={pushOnClick(ev.tags[j])} />)
                        break
                    case "e":
                        elements.push(<Tag key={j}
                            tag={ev.tags[j]}
                            onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [["e", ev.tags[j][1], relay_string, "mention"]]) }}
                            friendlist={friendlist}
                            onClick={pushOnClick(["e", ev.tags[j][1], relay_string, "mention"])} />)
                        break
                    default:
                        break
                }
            }
        }
        return (<div className="tags"> {elements.map((t) => t)}</div>)
    }, [])
    const bodyJSX = useMemo(() => {
        let content = ev.content.replaceAll(/lnbc[0-9,a-z]*/g, "*lightning-invoice*")
        let pieces: JSX.Element[] = []
        let note = nip19.noteEncode(ev.id as string)
        for (let j in ev.tags) {
            if (ev.tags[j][0] === "subject") {
                pieces.push(<span key="subject" className="subject">Subject: {ev.tags[j][1]}</span>)
                break
            }
        }
        let regexp = /#\[[0-9]+?\]/
        for (let i = 0; i < 110; i++) {
            let ind = content.search(regexp)
            var content_piece: string
            if (ind === -1) {
                content_piece = content
            } else {
                content_piece = content.substring(0, ind)
            }
            if (content_piece !== "") {
                let https_ind = content_piece.search(/https:\/\//g)
                if (https_ind === -1) {
                    pieces.push(<React.Fragment key={5 * i}>{content_piece}</React.Fragment>)
                } else {
                    let pre = content_piece.substring(0, https_ind)
                    let mid = content_piece.substring(https_ind,)
                    var url: string
                    var end: string
                    let end_index = mid.search("[\\n, ]")
                    if (end_index === -1) {
                        url = mid
                        end = ""
                    } else {
                        url = mid.substring(0, end_index)
                        end = mid.substring(end_index,)
                    }
                    if (pre !== "") {
                        pieces.push(<React.Fragment key={5 * i + 2}>{pre}</React.Fragment>)
                    }
                    if (url !== "") {
                        pieces.push(<a href={url} target="_blank" key={5 * i + 3}>URL</a>)
                    }
                    if (end !== "") {
                        content = end
                        continue
                    }
                }
            }
            if (ind === -1) {
                break
            }
            let len = content.substring(ind,).search("\\]") + 1
            let j = Number(content.substring(ind + 2, ind + len - 1))
            if (!isNaN(j) && (ev.tags[j] !== undefined)) {
                switch (ev.tags[j][0]) {
                    case "p":
                        pieces.push(<Tag key={5 * i + 1} onContextMenu={() => {}} friendlist={friendlist} onClick={pushOnClick(ev.tags[j])} tag={ev.tags[j]} />)
                        break
                    case "e":
                        pieces.push(<Tag key={5 * i + 1} onContextMenu={() => {}} friendlist={friendlist} onClick={pushOnClick(ev.tags[j])} tag={ev.tags[j]} />)
                        break
                    default:
                        let txt = ev.tags[j][1]
                        pieces.push(<React.Fragment key={5 * i + 1} > #{txt}</ React.Fragment>)
                }
            }
            content = content.substring(ind + len)
            if (content === "") {
                break
            }
        }
        var dateObj = new Date(ev.created_at * 1000);
        var timeString = dateObj.toLocaleTimeString('en-US', { "hourCycle": "h23", "weekday": "short", "month": "short", "day": "2-digit" });
        let npub = nip19.npubEncode(ev.pubkey)
        let topsig = <div className="topsig">
            <a className="author" href={"nostr:" + npub} onClick={pushOnClick(["p", ev.pubkey])} onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [["p", ev.pubkey]]) }}> {author_name.padEnd(12, " ").substring(0, 12)}</ a >
            <span className="timestamp">{timeString}</span>
            <a className="noteId" href={"nostr:" + note} onClick={pushOnClick(["e", ev.id as string, relay_url, "mention"])} onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [["e", ev.id as string, relay_url, "mention"]]) }}> {note.substring(0, 12)}</ a >
            <a className="reply" onClick={replyTagsOnClick}>reply</a>
            <a className="hide" onClick={hideOnClick}>hide</a>
        </div >
        return <>
            {topsig}
            <div className="textcontent">
                {pieces.map((p) => p)}
            </div>
        </>
    }, [ev, relay_url, pk, author_name, friendlist])

    //filtering
    let in_e_tags: boolean = false
    let refs_e_tags: boolean = false
    let exist_e_tags: boolean = false
    let in_p_tags: boolean = false
    let refs_p_tags: boolean = false
    let exist_p_tags: boolean = false
    for (let j in reply_tags) {
        if (reply_tags[j][0] === "e") {
            if (!exist_e_tags) {
                exist_e_tags = true
            }
            if (!in_e_tags && reply_tags[j][1] === ev.id) {
                in_e_tags = true
            }
            if (!refs_e_tags) {
                for (let k in ev.tags) {
                    if (ev.tags[k][0] === "e" && ev.tags[k][1] == reply_tags[j][1]) {
                        refs_e_tags = true
                        break
                    }
                }
            }
        }
        if (reply_tags[j][0] === "p") {
            if (!exist_p_tags) {
                exist_p_tags = true
            }
            if (!in_p_tags && reply_tags[j][1] === ev.pubkey) {
                in_p_tags = true
            }
            if (!refs_p_tags) {
                for (let k in ev.tags) {
                    if (ev.tags[k][0] === "p" && ev.tags[k][1] == reply_tags[j][1]) {
                        refs_p_tags = true
                        break
                    }
                }
            }
        }
        if (refs_e_tags && in_e_tags && refs_p_tags && in_p_tags) {
            break
        }
    }
    return (
        !exist_e_tags && !exist_p_tags ||
        in_e_tags || refs_e_tags ||
        (refs_p_tags || in_p_tags) && !exist_e_tags
    ) ? (<div className={"post" + ((ev.pubkey === pk) ? " me" : " other")}>
        <>{bodyJSX}{tail}</>
    </ div>
    )
        : <></>;
}



function App() {
    const eose = useRef(false)
    const ids_exist_ref = useRef([] as string[])
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
        } else {
            console.log("ping")
        }
    }, [])

    const publish = useCallback((content: string, reply_tags: string[][], cb: () => void) => {
        let textcontent: string
        let tags: string[][] = []
        let has_subject: boolean = false
        for (let i in reply_tags) {
            //only one subject
            if ((reply_tags[i][0] === "subject") && !has_subject) {
                has_subject = true
                continue
            }
        }
        tags = [...reply_tags]
        if ((content.search("^[S,s]ubject:") === -1) || has_subject) {
            textcontent = content
        } else {
            let end_subject = content.search("\n")
            textcontent = content.substring(end_subject + 1,)
            let begin_subject = content.search(":")
            tags.push(["subject", content.substring(begin_subject + 1, end_subject).trim()])
        }
        let event: Event = {
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags: tags,
            content: textcontent,
            pubkey: pk,
        }
        localStorage.setItem(pk + "time", Math.floor(Date.now() / 1000).toString())
        window.nostr.signEvent(event).then(publish_raw(cb)).catch(console.log)
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
            <div className={"nostrfeed"}><span>gnostr</span></div>
            <div className="loginBox">
                {pk === "" && <a onClick={pubkeyConnect}>{"Connect to browser extension"}</a>}
                {pk !== "" && <>
                    <div>{connected ? <span className="hide" onClick={() => { r.current.close() }}>Connected to: {url}</span> : <form onSubmit={(e) => { e.preventDefault(); relayConnect() }}><button className="connect_button" type="submit">{"Connect to:"}</button><input value={url} autoFocus={false} onChange={(e) => set_url(() => e.target.value)}></input></form>} </div>
                    <div><span className="gray">Logged in as:</span> <Tag tag={["p", pk]} friendlist={friendlist} onClick={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} /></div>
                </>}
            </div>
            {connected && <>
                <FriendBox friendlist={friendlist} set_friendlist={set_friendlist} publish={publish_raw(() => {})} fetch_friendlist={fetch_friendlist} reply_tags={reply_tags} set_reply_tags={set_reply_tags} />
                <SubBox friendlist={friendlist} fetcher={fetch_p_tags} subs={subs} set_reply_tags={set_reply_tags} reply_tags={reply_tags} />
                <MainTextArea friendlist={friendlist} publish={publish} reply_tags={reply_tags} set_reply_tags={set_reply_tags} />
            </>
            }
            <div id="notelist">
                {(eose) &&
                    <>
                        {disps.map(
                            (e: Event) => <Post key={e.id} ev={e} reply_tags={reply_tags} set_reply_tags={set_reply_tags} set_disps={set_disps} relay_url={url} pk={pk} friendlist={friendlist} fetcher={fetch_e_tags} />)
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
