import { _converse, api } from '@converse/headless/core';
import BaseModal from 'plugins/modal/modal.js';
import { html } from 'lit';

const { __ } = _converse;

class JingleSessionModal extends BaseModal {
    initialize() {
        super.initialize();
        this.modalSize = 'modal-xl';
        this.addEventListener('hide.bs.modal', () => {
            const { onClose } = this;
            this.onClose = null;
            onClose?.();
        });
    }

    toggleAudio(ev) {
        this.session.localStream.getAudioTracks()[0].enabled = ev.target.checked;
    }

    toggleVideo(ev) {
        if(this.session.localStream.getVideoTracks().length == 0) {
            if(ev.target.checked) {
                this.session.enableVideo().catch(err => {
                    console.error("failed to enable video", err);
                });
            }
        } else {
            this.session.localStream.getVideoTracks()[0].enabled = ev.target.checked;
        }
    }

    getModalTitle() {
        return __('Conference with %1$s', this.displayName);
    }

    renderModal() {
        return html`
            <div style="display: flex; flex-grow: 1; gap: .5rem; justify-content: space-evenly; align-items: center; align-self: center; width: 100%">
                <video playsInline autoPlay .srcObject=${this.session.remoteStream} style="max-width: 45%"></video>
                <video playsInline autoPlay .muted=${true} .srcObject=${this.session.localStream} style="max-width: 45%"></video>
            </div>
        `;
    }

    renderModalFooter() {
        const audioEnabled = this.session.localStream.getAudioTracks()[0]?.enabled ?? false;
        const videoEnabled = this.session.localStream.getVideoTracks()[0]?.enabled ?? false;
        return html`
            <div class="btn btn-secondary form-check form-switch">
                <input type="checkbox" class="form-check-input" id="jingle-audio-control" .checked=${audioEnabled} @change=${ev => this.toggleAudio(ev)}></input>
                <label class="form-check-label" for="jingle-audio-control">Audio</label>
            </div>
            <div class="btn btn-secondary form-check form-switch">
                <input type="checkbox" class="form-check-input" id="jingle-video-control" .checked=${videoEnabled} @change=${ev => this.toggleVideo(ev)}></input>
                <label class="form-check-label" for="jingle-video-control">Video</label>
            </div>
            <button type="button" class="btn btn-danger" data-dismiss="modal">${__('Close')}</button>
        `;
    }
}

api.elements.define('converse-jingle-session-modal', JingleSessionModal);
