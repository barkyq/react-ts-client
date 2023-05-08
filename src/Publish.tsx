import React, { useState } from 'react'
import './App.css'
import {
    nip19,
    Event,
} from 'nostr-tools'

import { Tags } from './Tags'

export const prepare_content = (content: string, reply_tags: string[][], pk: string) => {
    let textcontent: string
    let tags: string[][] = []
    let subject_tag: string[] = []
    for (let i in reply_tags) {
        //only one subject
        if ((reply_tags[i][0] === "subject") && subject_tag.length == 0) {
            subject_tag = reply_tags[i]
        } else {
            tags.push(reply_tags[i])
        }
    }
    if ((content.search("^[S,s]ubject:") === -1)) {
        textcontent = content
    } else {
        let end_subject = content.search("\n")
        textcontent = content.substring(end_subject + 1,)
        let begin_subject = content.search(":")
        subject_tag = ["subject", content.substring(begin_subject + 1, end_subject).trim()]
    }
    if (subject_tag.length > 0) {
        tags.push(subject_tag)
    }

    while (true) {
        let result = textcontent.match(/note1[a-z0-9]{58}/)
        if (result !== null) {
            let d = nip19.decode(result[0])
            if (d.type === 'note') {
                let index = tags.length
                for (let i in tags) {
                    if (tags[i][0] === "e" && tags[i][1] == d.data) {
                        index = Number(i)
                    }
                }
                textcontent = textcontent.substring(0, result.index) + "#[" + index + "]" + textcontent.substring(result.index as number + result[0].length,)
                index === tags.length && tags.push(["e", d.data as string, "", "mention"])
            }
        } else {
            break
        }
    }

    while (true) {
        let result = textcontent.match(/npub1[a-z0-9]{58}/)
        if (result !== null) {
            let d = nip19.decode(result[0])
            if (d.type === 'npub') {
                let index = tags.length
                for (let i in tags) {
                    if (tags[i][0] === "p" && tags[i][1] == d.data) {
                        index = Number(i)
                    }
                }
                textcontent = textcontent.substring(0, result.index) + "#[" + index + "]" + textcontent.substring(result.index as number + result[0].length,)
                index === tags.length && tags.push(["p", d.data as string])
            }
        } else {
            break
        }
    }

    while (true) {
        let result = textcontent.match(/#[a-zA-Z0-9]+/)
        if (result !== null) {
            textcontent = textcontent.substring(0, result.index) + "#[" + tags.length + "]" + textcontent.substring(result.index as number + result[0].length,)
            tags.push(["t", result[0].substring(1,)])
        } else {
            break
        }
    }

    let exp: number = Math.floor(Date.now() / 1000) + 86400
    tags.push(["expiration", exp.toString()])
    let event: Event = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: textcontent,
        pubkey: pk,
    }
    return event
}

export const MainTextArea: React.FC<{ friendlist: Event, reply_tags: string[][], set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, publish: (content: string, reply_tags: string[][], cb: () => void) => void, stash: (content: string, reply_tags: string[][], cb: () => void) => void }> = ({
    friendlist,
    reply_tags,
    set_reply_tags,
    publish,
    stash,
}) => {
    const [content, set_content] = useState('' as string)
    const [hidden, set_hidden] = useState(true)
    return (
        <div className="maintextarea">
            <div>
                {!hidden ? <textarea className="maintextarea" spellCheck="false" value={content} onChange={(e) => set_content(() => e.target.value)}></textarea> : <></>}
                {!hidden ? <div id="stash_button" onClick={() => { stash(content, reply_tags, () => set_content(() => "" as string)); }}>stash</div> : <></>}
                {!hidden ? <div id="publish_button" onClick={() => {
                    publish(content, reply_tags, () => {
                        set_content(() => "" as string);
                    })
                }}>publish</div> : <></>}
                {<div id="hide_button" onClick={() => set_hidden((hidden) => !hidden)}>{hidden ? "expand" : "hide"}</div>}
            </div>
            {!hidden ? <div>
                <Tags reply_tags={reply_tags} set_reply_tags={set_reply_tags} friendlist={friendlist} />
            </div> : <></>}
        </div >
    )
}
