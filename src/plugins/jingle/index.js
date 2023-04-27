import { _converse, api, converse } from '@converse/headless/core';
import sizzle from 'sizzle';
import { html } from 'lit';

import './proposal-modal';
import './session-modal';
import { JingleSession } from 'webrtc-jingle-session';

const { Strophe, $build, $msg } = converse.env;
const { __ } = _converse;

Strophe.addNamespace('JINGLE', 'urn:xmpp:jingle:1');
Strophe.addNamespace('JINGLE_MESSAGE', 'urn:xmpp:jingle-message:0');
Strophe.addNamespace('JINGLE_ICE_UDP', 'urn:xmpp:jingle:transports:ice-udp:1'); // old ICE transport (ICE-UDP only)
Strophe.addNamespace('JINGLE_ICE', 'urn:xmpp:jingle:transports:ice:0'); // new ICE transport (both ICE-UDP & ICE-TCP)
Strophe.addNamespace('JINGLE_RTP', 'urn:xmpp:jingle:apps:rtp:1');

const INITIATION_STATE = {
    none: 0,
    proposed: 1,
    requested: 2,
    accepted: 3,
};

let state, peerJid, sid, session, video, proposalModal, sessionModal;

function reset() {
    if(proposalModal) {
        proposalModal.onAccept = null;
        proposalModal.onReject = null;
        proposalModal.modal.hide();
        proposalModal = null;
    }
    if(sessionModal) {
        sessionModal.onClose = null;
        sessionModal.modal.hide();
        sessionModal = null;
    }
    state = INITIATION_STATE.none;
    peerJid = null;
    sid = null;
    session = null;
    video = false;
}

async function openJingleProposalModal(data, jid, sid) {
    const { chatbox } = data;

    const onAccept = async (withVideo) => {
        if(chatbox) {
            await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('you have accepted %1$s\'s conference proposal', await chatbox.getDisplayName()), time: data.attrs.time});
        }
        state = INITIATION_STATE.accepted;
        video = withVideo;
        api.send($msg({to: jid, type: 'chat'})
            .c('store', {xmlns: Strophe.NS.HINTS}).up()
            .c('proceed', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: sid}));
    };

    const onReject = async () => {
        if(chatbox) {
            await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('you have rejected %1$s\'s conference proposal', await chatbox.getDisplayName()), time: data.attrs.time});
        }
        api.send($msg({to: data.attrs.from, type: 'chat'})
            .c('store', {xmlns: Strophe.NS.HINTS}).up()
            .c('reject', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: sid})
                .c('reason', {xmls: Strophe.NS.JINGLE})
                    .c('decline').up()
                    .c('text').t('Declined'));
        reset();
    };

    const displayName = await (await api.contacts.get(jid)).getDisplayName();
    proposalModal = api.modal.show('converse-jingle-session-proposal-modal', { displayName, onAccept, onReject });
}

async function openJingleSessionModal() {
    const onClose = () => {
        session?.close();
        notifyTerminate(peerJid);
        finish(sid, peerJid, 'success', 'Success');
        reset();
    }

    const displayName = await (await api.contacts.get(peerJid)).getDisplayName();
    sessionModal = api.modal.show('converse-jingle-session-modal', { displayName, session, onClose });
}

async function handlePropose(data, init) {
    const { chatbox } = data;

    const peerSid = init.getAttribute('id');

    if(state == INITIATION_STATE.none || (state == INITIATION_STATE.proposed && Strophe.getBareJidFromJid(peerJid) == data.attrs.from)) {
        if(state == INITIATION_STATE.none) {
            if(chatbox) {
                await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('%1$s has proposed a conference', await chatbox.getDisplayName()), time: data.attrs.time});
            }

            state = INITIATION_STATE.requested;
            peerJid = data.stanza.getAttribute('from');
            sid = peerSid;

            api.send($msg({to: data.attrs.from, type: 'chat'})
                .c('store', {xmlns: Strophe.NS.HINTS}).up()
                .c('ringing', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: peerSid}));

            openJingleProposalModal(data, data.attrs.from, sid);
        } else {
            if(sid < peerSid) {
                api.send($msg({to: data.attrs.from, type: 'chat'})
                    .c('store', {xmlns: Strophe.NS.HINTS}).up()
                    .c('reject', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: peerSid})
                        .c('tie-break').up()
                        .c('reason', {xmls: Strophe.NS.JINGLE})
                            .c('expired').up()
                            .c('text').t('Tie-Break'));

            } else if(sid > peerSid) {
                // Received the lower id, accept peer session, ours has been automatically rejected by peer tie-breaking process
                state = INITIATION_STATE.accepted;
                sid = init.getAttribute('id');
                peerJid = data.stanza.getAttribute('from');
                api.send($msg({to: data.attrs.from, type: 'chat'})
                    .c('store', {xmlns: Strophe.NS.HINTS}).up()
                    .c('proceed', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: peerSid}));
            } else {
                console.error('Both sessions share the same ID in the tie breaking process, give up');
                reset();
            }
        }
    } else {
        // Already handling one proposal (or already in conference), reject
        if(chatbox) {
            await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('%1$s has proposed a conference, but you were not available', await chatbox.getDisplayName()), time: data.attrs.time});
        }

        api.send($msg({to: data.attrs.from, type: 'chat'})
            .c('store', {xmlns: Strophe.NS.HINTS}).up()
            .c('reject', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: peerSid})
                .c('reason', {xmls: Strophe.NS.JINGLE})
                    .c('busy').up()
                    .c('text').t('Busy'));
    }
}

async function handleRetract(data, init) {
    const peerSid = init.getAttribute('id');
    if(data.attrs.from != Strophe.getBareJidFromJid(peerJid) || peerSid != sid || state != INITIATION_STATE.requested) {
        console.error('retract: session mismatch');
        return;
    }

    const { chatbox } = data;
    if(chatbox) {
        await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('%1$s has canceled its conference proposal', await chatbox.getDisplayName()), time: data.attrs.time});
    }

    reset();
}

async function handleProceed(data, init) {
    const peerSid = init.getAttribute('id');
    if(data.attrs.from != Strophe.getBareJidFromJid(peerJid) || peerSid != sid || state != INITIATION_STATE.proposed) {
        console.error('proceed: session mismatch');
        return;
    }

    peerJid = data.stanza.getAttribute('from');
    state = INITIATION_STATE.accepted;
    const iceSupport = await api.disco.supports(Strophe.NS.JINGLE_ICE, peerJid);
    session = new JingleSession($build, _converse.connection, api.sendIQ);
    session.create(peerJid, video, iceSupport, sid)
        .then(() => openJingleSessionModal())
        .catch(err => {
            console.error("Faield to create jingle session", err);
            session.close('general-error', 'Error');
            notifyTerminate(peerJid);
            finish(sid, peerJid, 'general-error', 'Error');
            reset();
        });

    const { chatbox } = data;
    if(chatbox) {
        await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('%1$s has accepted your conference proposal', await chatbox.getDisplayName()), time: data.attrs.time});
    }
}

async function handleReject(data, init) {
    const peerSid = init.getAttribute('id');
    if(data.attrs.from != Strophe.getBareJidFromJid(peerJid) || peerSid != sid || state != INITIATION_STATE.proposed) {
        console.error('reject: session mismatch');
        return;
    }

    const { chatbox } = data;
    if(chatbox) {
        await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('%1$s has declined your conference proposal', await chatbox.getDisplayName()), time: data.attrs.time});
    }

    reset();
}

async function handleMessageInitiation(data, init) {
    switch(init.localName) {
        case 'propose':
            await handlePropose(data, init);
            break;
        case 'proceed':
            await handleProceed(data, init);
            break;
        case 'retract':
            await handleRetract(data, init);
            break;
        case 'reject':
            await handleReject(data, init);
            break;
    }
}

async function handleMessage (data) {
    const { attrs } = data;
    if (!attrs || attrs.is_forwarded) {
        return;
    }

    const init = sizzle(`*[xmlns='${Strophe.NS.JINGLE_MESSAGE}']`, data.stanza).pop();
    if (init) {
        await handleMessageInitiation(data, init);
    }
}

async function notifyTerminate(peerJid) {
    const jid = Strophe.getBareJidFromJid(peerJid);
    const chatbox = await api.chatboxes.get(jid);
    if(chatbox) {
        await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('conference terminated'), time: new Date().toISOString()});
    }
}

function finish(sid, to, reason, text) {
    api.send($msg({to, type: 'chat'})
        .c('store', {xmlns: Strophe.NS.HINTS}).up()
        .c('finish', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: sid})
            .c('reason', {xmlns: Strophe.NS.JINGLE})
                .c(reason).up()
                .c('text').t(text));
}

function handleJingleIQ (stanza) {
    const jingle = sizzle('jingle', stanza).pop();
    if(!jingle || Strophe.getBareJidFromJid(stanza.getAttribute('from')) != Strophe.getBareJidFromJid(peerJid) || jingle.getAttribute('sid') != sid) {
        console.error('Invalid jingle iq', );
        return true;
    }

    let reset_on_failure = false;
    switch(jingle.getAttribute('action')) {
        case 'session-initiate':
            if(state != INITIATION_STATE.accepted) {
                console.log('Session not accepted');
                return true;
            }

            session = new JingleSession($build, _converse.connection, api.sendIQ);
            session.accept(stanza, video)
                .then(() => openJingleSessionModal())
                .catch(err => {
                    console.error('Failed to create jingle session', err);
                    session.close('general-error', 'Error');
                    notifyTerminate(peerJid);
                    finish(sid, peerJid, 'general-error', 'Error');
                    reset();
                });
            break;
        case 'session-accept':
            // fallthrough
        case 'content-modify':
            reset_on_failure = true;
            // fallthrough
        case 'session-terminate':
            // fallthrough
        case 'transport-info':
            session.handleIQ(stanza)
                .then(() => {
                    if(jingle.getAttribute('action') == 'session-terminate') {
                        notifyTerminate(peerJid);
                        finish(sid, peerJid, 'success', 'Success');
                        reset();
                    }
                })
                .catch(err => {
                    console.error(err);
                    if(reset_on_failure) {
                        session.close('general-error', 'Error');
                        notifyTerminate(peerJid);
                        finish(sid, peerJid, 'general-error', 'Error');
                        reset();
                    }
                });
    }

    return true;
}

async function proposeSession(jid, enable_video) {
    if(state != INITIATION_STATE.none) {
        return;
    }

    state = INITIATION_STATE.proposed;
    peerJid = jid;
    sid = _converse.connection.getUniqueId();
    video = enable_video;

    api.send($msg({to: jid, type: 'chat'})
        .c('store', {xmlns: Strophe.NS.HINTS}).up()
        .c('propose', {xmlns: Strophe.NS.JINGLE_MESSAGE, id: sid})
            .c('description', {media: 'audio', xmlns: Strophe.NS.JINGLE_RTP}).up()
            .c('description', {media: 'video', xmlns: Strophe.NS.JINGLE_RTP}));

    const chatbox = await api.chatboxes.get(jid);
    if(chatbox) {
        await chatbox.createMessage({type: 'info', is_ephemeral: false, message: __('you have proposed a conference'), time: new Date().toISOString()});
    }
}

converse.plugins.add('converse-jingle', {
    initialize () {
        reset();
        api.listen.on('addClientFeatures', () => {
            api.disco.own.features.add(Strophe.NS.JINGLE);
            api.disco.own.features.add(Strophe.NS.JINGLE_ICE_UDP);
            api.disco.own.features.add(Strophe.NS.JINGLE_ICE);
        });
        api.listen.on('initialized', () => {
            api.listen.on('message', handleMessage);
            api.listen.stanza('iq', {ns: Strophe.NS.JINGLE}, handleJingleIQ);
        });
        api.listen.on('getToolbarButtons', (toolbar_el, buttons) => {
            const jid = toolbar_el.model.id;
            if(!toolbar_el.is_groupchat) {
                buttons.push(html`
                    <button title="Audio Call" @click=${() => proposeSession(jid, false)}><converse-icon class="fa fa-phone" size="1em" /></button>
                `);
                buttons.push(html`
                    <button title="Video Call" @click=${() => proposeSession(jid, true)}><converse-icon class="fa fa-video" size="1em" /></button>
                `);
            }
            return buttons;
        });
    },
});
