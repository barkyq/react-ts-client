import React, { useCallback, useMemo } from 'react'
import './App.css'
import {
    Event,
    nip19,
} from 'nostr-tools'

import { Tag, generate_reply_tags } from './Tags'
// need to useMemo to cache the output of various renderings
export const Post: React.FC<{ ev: Event, reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, set_disps: React.Dispatch<React.SetStateAction<Event[]>>, pk: string, friendlist: Event, fetcher: (tags: string[][]) => void, publish: (e: Event) => void, seen_conn: string[] }> = ({
    ev,
    reply_tags,
    set_reply_tags,
    set_disps,
    pk,
    friendlist,
    fetcher,
    publish,
    seen_conn
}) => {
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
            console.log(ev.content)
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
        let reply_tags = generate_reply_tags(ev, pk)
        set_reply_tags(() => reply_tags)
    }, [ev, pk])
    const hideOnClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        ev.pubkey === pk &&
            window.nostr.getPublicKey().then((p) => {
                let event: Event = {
                    kind: 5,
                    created_at: Math.floor(Date.now() / 1000),
                    tags: [["e", ev.id as string]],
                    content: "",
                    pubkey: p,
                }
                window.nostr.signEvent(event).then(publish)
            })
        set_disps((curr: Event[]) => {
            let copy: Event[] = []
            for (let i in curr) {
                (curr[i].id !== ev.id) && copy.push(curr[i])
            }
            return copy
        })
    }, [ev])
    const publishOnClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        publish(ev)
    }, [ev])
    const tail = useMemo(() => {
        let elements: JSX.Element[] = []
        for (let j in ev.tags) {
            let tag = "#[" + j.toString() + "]"
            if ((ev.tags[j][0] === "e" || ev.tags[j][0] === "p") && (ev.content.indexOf(tag) === -1)) {
                var relay_string: string
                switch (ev.tags[j][2]) {
                    case undefined:
                        relay_string = ""
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
        return (elements.length > 0 ? <div className="tags"> {elements.map((t) => t)}</div> : <></>)
    }, [])
    const bodyJSX = useMemo(() => {
        let content = ev.content.replaceAll(/lnbc[0-9,a-z]*/ig, "*lightning-invoice*")
        let pieces: JSX.Element[] = []
        for (let j in ev.tags) {
            if (ev.tags[j][0] === "subject") {
                pieces.push(<span key="subject" className="subject">Subject: {ev.tags[j][1]}</span>)
                break
            }
        }
        let regexp = /#\[[0-9]+?\]/
        for (let i = 0; i < 110; i++) {
            let ind = content.match(regexp)
            var content_piece: string
            if (ind === null) {
                content_piece = content
            } else {
                content_piece = content.substring(0, ind.index)
            }
            while (content_piece !== "") {
                let https_match = content_piece.match(/https:\/\/[a-zA-Z0-9_\/\-.]*/)
                if (https_match === null) {
                    pieces.push(<React.Fragment key={pieces.length}>{content_piece}</React.Fragment>)
                    break
                } else {
                    let pre = content_piece.substring(0, https_match.index)
                    let end_index = https_match.index as number + https_match[0].length
                    if (pre !== "") {
                        pieces.push(<React.Fragment key={pieces.length}>{pre}</React.Fragment>)
                    }
                    pieces.push(<a href={https_match[0]} target="_blank" key={pieces.length}>URL</a>)
                    content_piece = content_piece.substring(end_index,)
                }
            }
            if (ind === null || ind.index === undefined) {
                break
            }
            let len = ind[0].length
            content = content.substring(ind.index + len,)
            let j = Number(ind[0].substring(2, len - 1))
            if (!isNaN(j) && (ev.tags[j] !== undefined)) {
                switch (ev.tags[j][0]) {
                    case "p":
                        pieces.push(<Tag key={pieces.length} onContextMenu={() => {}} friendlist={friendlist} onClick={pushOnClick(ev.tags[j])} tag={ev.tags[j]} />)
                        break
                    case "e":
                        pieces.push(<Tag key={pieces.length} onContextMenu={() => {}} friendlist={friendlist} onClick={pushOnClick(ev.tags[j])} tag={ev.tags[j]} />)
                        break
                    case "t":
                        let txt = ev.tags[j][1]
                        pieces.push(<span className="ttag" key={pieces.length} >{txt}</ span>)
                        break
                }
            }
            if (content === "") {
                break
            }
        }
        return <>
            <div className="textcontent">
                {pieces.map((p) => p)}
            </div>
        </>
    }, [ev, pk, author_name, friendlist])

    let seen = useMemo(() => {
        for (let j in seen_conn) {
            if (seen_conn[j] === ev.id) {
                return true
            }
        }
        return false
    }, [seen_conn])
    let topSig = useMemo(() => {
        var dateObj = new Date(ev.created_at * 1000);
        var timeString = dateObj.toLocaleTimeString('en-US', { "hourCycle": "h23", "weekday": "short", "month": "short", "day": "2-digit" });
        let npub = nip19.npubEncode(ev.pubkey)
        let note = nip19.noteEncode(ev.id as string)
        return <div className="topsig">
            <a className="author" href={"nostr:" + npub} onClick={pushOnClick(["p", ev.pubkey])} onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [["p", ev.pubkey]]) }}> {author_name.padEnd(12, " ").substring(0, 12)}</ a >
            <span className="timestamp">{timeString}</span>
            <a className="noteId" href={"nostr:" + note} onClick={pushOnClick(["e", ev.id as string, "", "mention"])} onContextMenu={(e) => { e.preventDefault(); set_reply_tags(() => [["e", ev.id as string, "", "mention"]]) }}> {note.substring(0, 12)}</ a >
            {seen ? <span className="timestamp">S</span> : <a className="reply" onClick={publishOnClick}>P</a>}
            <a className="reply" onClick={replyTagsOnClick}>reply</a>
            <a className="hide" onClick={hideOnClick}>{ev.pubkey === pk ? "del" : "hide"}</a>
        </div >
    }, [ev, author_name, friendlist, seen])

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
        <>{topSig}{bodyJSX}{tail}</>
    </ div>
    )
        : <></>;
}
