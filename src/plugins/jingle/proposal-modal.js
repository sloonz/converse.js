import { _converse, api } from '@converse/headless/core';
import BaseModal from 'plugins/modal/modal.js';
import { html } from 'lit';

const { __ } = _converse;

class JingleSessionProposalModal extends BaseModal {
    initialize() {
        super.initialize();
        this.addEventListener('hide.bs.modal', () => {
            const { onReject } = this;
            this.onReject = null;
            this.onAccept = null;
            onReject?.();
        });
    }

    getModalTitle() { // eslint-disable-line class-methods-use-this
        return __('Conference Proposal');
    }

    renderModal() {
        return __('%1$s wants to start a conference with you.', this.displayName);
    }

    doAccept(withVideo) {
        const { onAccept } = this;
        this.onReject = null;
        this.onAccept = null;
        onAccept?.(withVideo);
        this.modal.hide();
    }

    renderModalFooter() {
        return html`
            <button type="button" class="btn btn-primary" @click=${() => this.doAccept(true)}>${__('Accept with Video')}</button>
            <button type="button" class="btn btn-primary" @click=${() => this.doAccept(false)}>${__('Accept with Audio only')}</button>
            <button type="button" class="btn btn-danger" data-dismiss="modal">${__('Refuse')}</button>
        `;
    }
}

api.elements.define('converse-jingle-session-proposal-modal', JingleSessionProposalModal);

export default JingleSessionProposalModal;
