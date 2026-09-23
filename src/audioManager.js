import { gsap } from 'gsap';

// Colonna sonora ambientale: parte solo su gesto dell'utente (policy autoplay dei browser)
export class AudioManager {
    constructor(src = '/asset/background.mp3', volume = 0.45) {
        this.targetVolume = volume;
        this.playing = false;
        this.audio = new Audio(src);
        this.audio.loop = true;
        this.audio.preload = 'none';
        this.audio.volume = 0;
    }

    async play() {
        try {
            await this.audio.play();
            this.playing = true;
            gsap.to(this.audio, { volume: this.targetVolume, duration: 2.2, ease: 'power1.out', overwrite: true });
        } catch (error) {
            console.warn('Audio non disponibile:', error);
            this.playing = false;
        }
        return this.playing;
    }

    pause() {
        this.playing = false;
        gsap.to(this.audio, {
            volume: 0,
            duration: 1.2,
            ease: 'power1.in',
            overwrite: true,
            onComplete: () => { if (!this.playing) this.audio.pause(); },
        });
    }

    toggle() {
        if (this.playing) {
            this.pause();
            return Promise.resolve(false);
        }
        return this.play();
    }
}
