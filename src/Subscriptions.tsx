import React, { useState, useMemo } from 'react'
import './App.css'
import {
    Event,
    Filter,
    Sub,
} from 'nostr-tools'

export interface Subscription {
    underlying: Sub,
    filters: Filter[],
}

export interface SubInfo {
    type: string,
    tag: string[],
    since: number,
    active?: boolean
}

import { Tag } from './Tags'

export const SubBox: React.FC<{ subs: Subscription[], fetcher: (update: SubInfo[], old_info: SubInfo[], cb: () => void) => void, friendlist: Event, set_reply_tags: React.Dispatch<React.SetStateAction<string[][]>>, reply_tags: string[][] }> = ({
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
