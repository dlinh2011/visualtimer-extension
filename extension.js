/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

'use strict';

const GETTEXT_DOMAIN = 'my-indicator-extension';

const { Gio, GObject, St, Clutter } = imports.gi;

const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Slider = imports.ui.slider;
const Config = imports.misc.config;
const MIN_TIME = 60;
const MAX_TIME = 3600;

let timeoutID, actor;
let duration = 0;
let isTimer = false;

let temps = 0;

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, '${Me.metadata.name} Indicator', false);

            // create a panel face
            this.add_child(this.createPanelFace());
            // create a popupMenu 
            this.menu.addMenuItem(this.createPopupMenu());
        }

        createPanelFace() {
            let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
            actor = new St.DrawingArea({ style_class: 'analog-clock-area', reactive: true });
            actor.connect('repaint', redraw);
            box.add_child(actor);
            return box;
        }

        createPopupMenu() {
            /** The crux of this function is taken from the Gnome shell-extension egg-timer@gregorriegler.com */

            /* ------ PlayButton ------ */
            this.playIcon = new St.Icon({
                gicon: new Gio.ThemedIcon({ name: 'media-playback-start' }),
                style_class: 'system-status-icon',
            });
            this.playButton = new St.Button();
            this.playButton.connect('clicked', this.onClickPlayButton.bind(this));
            this.playButton.set_child(this.playIcon);
            let playButtonItem = new PopupMenu.PopupBaseMenuItem();
            playButtonItem.add(this.playButton);

            /** ------- Slider ------ */
            let sliderItem = new PopupMenu.PopupBaseMenuItem();
            this.timeSlider = new Slider.Slider(0);
            this.timeSlider.connect(valueChanged(), this.onSliderMoved.bind(this));
            sliderItem.add(this.timeSlider);

            /** ------ Print duration of Slider ------ */
            this.timeDisplay = new St.Label({
                text: prettyPrint(this.timeSlider.value),
                y_align: Clutter.ActorAlign.CENTER,
            });
            let timeDisplayItem = new PopupMenu.PopupBaseMenuItem();
            timeDisplayItem.add(this.timeDisplay);

            /** ------ Cancel Button -------- */
            this.cancelIcon = new St.Icon({
                gicon: new Gio.ThemedIcon({ name: 'cancel' }),
                style_class: 'system-status-icon',
            });
            this.cancelButton = new St.Button();
            this.cancelButton.connect('clicked', this.onClickCancelButton.bind(this));
            this.cancelButton.set_child(this.cancelIcon);
            let cancelButtonItem = new PopupMenu.PopupBaseMenuItem();
            cancelButtonItem.add(this.cancelButton);

            // add to menu
            let section = new PopupMenu.PopupMenuSection();
            section.addMenuItem(playButtonItem);
            section.addMenuItem(timeDisplayItem);
            section.addMenuItem(sliderItem);
            section.addMenuItem(cancelButtonItem);
            return section;
        }

        onClickCancelButton() {
            resetTimer();
        }

        onClickPlayButton() {
            // reset the VisualTimer
            duration = range(MIN_TIME, MAX_TIME, this.timeSlider.value);
            isTimer = true;
            // debug log("click play");
            addToMainloop();
        }

        onSliderMoved(item) {
            // change the display of duration of the slider 
            this.timeDisplay.set_text(prettyPrint(item.value));
        }

        destroy() {
            if (timeoutID) {
                Mainloop.source_remove(timeoutID);
                timeoutID = null;
            }
            actor.destroy();
            super.destroy();
        }

    }
);


/** static functions */

function addToMainloop() {
    timeoutID = Mainloop.timeout_add_seconds(30, function () {
        actor.queue_repaint();
        return true;
    });
}

function redraw(area) {
    /** The crux of this function is taken from the Gnome shell-extension analog-clock@sharats.me */
    let [width, height] = area.get_surface_size();
    let cr = area.get_context();
    try {
        Clutter.cairo_set_source_color(cr, actor.get_theme_node().get_foreground_color());
    } catch (e) {
        return;
    }
    cr.translate(Math.floor(width / 2), Math.floor(height / 2));

    // Dial circle
    cr.arc(0, 0, Math.floor(height / 2) - 3, 0, 2 * Math.PI);
    cr.setLineWidth(1.5);
    cr.stroke();
    cr.setLineWidth(1);


    /*
    // Central dot
    cr.arc(0, 0, 1.5, 0, 2 * Math.PI);
    cr.fill();
    */

    // log("duration() " + duration); // to debug
    let minuteSize = Math.floor(height * 0.45);
    let minuteAngle = (duration / 60) * Math.PI / 30;

    drawTimer(cr, minuteAngle, minuteSize);

    if (isTimer && duration <= 0) {
        Main.notify("Session ends");
        resetTimer();
        return;
    }

    let tempsNow = Date.now();

    // make sure that it's at least 30 seconds from the last redraw 
    // because hover or click on the panel item cause the CSS to change therefore also emits a 'repaint'

    if (isTimer && tempsNow - temps >= 30 * 1000 - 1) {
        duration -= 30;
        temps = tempsNow;
    }
}

function resetTimer() {
    Mainloop.source_remove(timeoutID);
    timeoutID = null;
    isTimer = false;
    temps = 0;
    duration = 0;
}


function drawTimer(cr, angle, size) {
    cr.save();
    cr.rotate(3 * Math.PI / 2);
    cr.setSourceRGB(0.5, 0.5, 1);
    cr.arc(0, 0, size, 0, angle);
    cr.lineTo(0, 0);
    cr.fill();
    cr.restore();
}

function valueChanged() {
    /** This function is taken from the Gnome shell-extension egg-timer@gregorriegler.com */
    return parseFloat(Config.PACKAGE_VERSION.substring(0, 4)) > 3.32
        ? 'notify::value'
        : 'value-changed'
}

function range(min, max, percentage) {
    /** This function is taken from the Gnome shell-extension egg-timer@gregorriegler.com */
    let range = max - min;
    let notRounded = range * percentage;
    let roundedToMinutes = Math.floor(notRounded / 60) * 60;
    return roundedToMinutes + min;
}

function prettyPrint(percentage) {
    /** This function is taken from the Gnome shell-extension egg-timer@gregorriegler.com */
    let duration = range(MIN_TIME, MAX_TIME, percentage);
    let minutes = parseInt(duration / 60, 10);
    let seconds = parseInt(duration % 60, 10);
    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;
    return minutes + ":" + seconds;
}










/** ----- MAIN ----- */

class Extension {
    constructor(uuid) {
        this._uuid = uuid;

        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);

    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
        duration = 0;
        isTimer = false;
        temps = 0;

    }
}

function init(meta) {
    return new Extension(meta.uuid);
}

