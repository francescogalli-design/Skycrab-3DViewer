import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function setupSmoothScrollParallax() {
    if (!document.querySelector('#smooth-wrapper') || !document.querySelector('#smooth-content')) {
        return;
    }

    gsap.utils.toArray('.scene-text').forEach((el) => {
        gsap.fromTo(el,
            { y: 80, opacity: 0 },
            {
                y: 0,
                opacity: 1,
                scrollTrigger: {
                    trigger: el,
                    start: "top 85%",
                    end: "bottom 50%",
                    scrub: 1,
                }
            }
        );
    });
}
