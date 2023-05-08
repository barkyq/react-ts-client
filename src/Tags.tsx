import React, { useCallback, useMemo } from 'react'
import './App.css'
import {
    nip19,
    Event,

} from 'nostr-tools'

export const generate_reply_tags = (e: Event, pk: string) => {
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
                    reply_tags.push([e.tags[i][0], e.tags[i][1], "", "root"])
                }
                break
            }
        }
    }
    if (has_root) {
        reply_tags.push(["e", (e.id as string), "", "reply"])
    } else {
        reply_tags.push(["e", (e.id as string), "", "root"])
    }
    return reply_tags
}


export const Tag: React.FC<{ tag: string[], onClick: React.MouseEventHandler, onContextMenu: React.MouseEventHandler, friendlist: Event }> = ({
    tag,
    onClick,
    onContextMenu,
    friendlist
}) => {
    let res = tag[1].match(/[a-f0-9]{64}/)
    if (res === null || res[0].length !== tag[1].length) {
        return <></>
    }
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


export const Tags: React.FC<{ reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, friendlist: Event }> = ({
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
