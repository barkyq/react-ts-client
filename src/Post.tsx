import React, { useCallback, useMemo } from 'react'
import './App.css'
import {
    Event,
    nip19,
} from 'nostr-tools'

import { Tag, generate_reply_tags } from './Tags'
// need to useMemo to cache the output of various renderings
export const Post: React.FC<{ ev: Event, reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, set_disps: React.Dispatch<React.SetStateAction<Event[]>>, relay_url: string, pk: string, friendlist: Event, fetcher: (tags: string[][]) => void }> = ({
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
        return (elements.length > 0 ? <div className="tags"> {elements.map((t) => t)}</div> : <></>)
    }, [])
    const bodyJSX = useMemo(() => {
        let content = ev.content.replaceAll(/lnbc[0-9,a-z]*/ig, "*lightning-invoice*")
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
                    case "t":
                        let txt = ev.tags[j][1]
                        pieces.push(<span className="ttag" key={5 * i + 1} >{txt}</ span>)
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
