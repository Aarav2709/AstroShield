/* global L, d3, gsap */

const gsapRef = window.gsap;

export default class ImpactViz {
    constructor(mapElementId) {
        this.map = L.map(mapElementId, {
            worldCopyJump: true,
            zoomControl: false,
        }).setView([20, 0], 2);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 7,
            attribution: "© OpenStreetMap contributors",
        }).addTo(this.map);

        this.craterCircle = null;
        this.radiusScale = d3.scaleLinear().domain([0, 30]).range([500, 120000]);
        this.warningEl = document.getElementById("tsunami-warning");
    }

    updateImpact({ lat, lon, craterDiameterKm, tsunamiRisk }) {
        if (this.craterCircle) {
            this.map.removeLayer(this.craterCircle);
        }

        this.craterCircle = L.circle([lat, lon], {
            radius: 0,
            color: "#ff4d4d",
            fillColor: "#ff4d4d",
            fillOpacity: 0.25,
            weight: 2,
        }).addTo(this.map);

        this.map.flyTo([lat, lon], 6, {
            animate: true,
            duration: 1.6,
        });

        const craterRadiusMeters = Math.max(this.radiusScale(craterDiameterKm || 0), 500);
        const tweenTarget = { value: 0 };
        gsapRef.to(tweenTarget, {
            value: craterRadiusMeters,
            duration: 1.6,
            ease: "power2.out",
            onUpdate: () => {
                this.craterCircle.setRadius(Math.max(tweenTarget.value, 250));
            },
        });

        this.toggleTsunami(tsunamiRisk);
    }

    toggleTsunami(active) {
        if (!this.warningEl) return;
        if (active) {
            this.warningEl.classList.add("visible");
        } else {
            this.warningEl.classList.remove("visible");
        }
    }
}
