# 🛡️ AstroShield Planetary Defense Simulator: Project Brief

This challenge requires developing **AstroShield**, an interactive, user-friendly tool to simulate asteroid impact scenarios, predict consequences, and evaluate mitigation strategies against a threat like **"Impactor-2025."**

## 💡 Your Mission: The "What If?" Simulator

Your primary goal is to **combine siloed data** (NASA space science and USGS Earth science) into one user-friendly platform that serves three key functions for both public and policy-maker audiences:

| Core Function | Description | Key Questions Answered |
| :--- | :--- | :--- |
| **Prediction** | Model the effects of an unmitigated impact scenario. | Where will it hit? How big will the explosion/crater be? What are the secondary effects (Tsunami, Earthquake)? |
| **Mitigation** | Evaluate the effectiveness of planetary defense maneuvers. | How much of a push ($\Delta V$) do we need to make it miss? What does the new, safer orbit look like? |
| **Communication** | Translate complex science into accessible, actionable insight. | Can the user understand the risk in 5 minutes? (Using 3D/2D maps, clear metrics, and educational tooltips). |

***

## 🚧 The Core Challenges You Must Overcome

| Challenge Area | Problem to Solve | Required Solution in Your Tool |
| :--- | :--- | :--- |
| **Data Integration** | NASA (asteroid parameters) and USGS (environmental/geological data) are separate datasets. | **Mock or Fetch:** Create a single **Flask API endpoint** that combines the required parameters from a mocked NASA NEO data source and a mocked USGS geological data source. |
| **Scientific Modeling** | Calculating physical effects (Kinetic Energy, Orbital Mechanics) is complex. | **Physics Engine:** Implement simplified, single-line math expressions for: 1. **Kinetic Energy** (in Megatons), 2. **Crater Diameter** (Crater Scaling), and 3. **Seismic Magnitude** ($M_w$). Use **Keplerian mechanics** (simplified) to visualize orbit changes. |
| **Visualization & UX** | Making 3D orbits and complex crater sizes clear and accessible to the public. | **Dual Visualization:** Use **Three.js** for the animated $\mathbf{3D}$ orbital path (pre/post-deflection) and **Leaflet/D3.js** for a $\mathbf{2D}$ map showing the impact point, the crater size, and the Tsunami Risk zone. |
| **Decision Support** | Policy-makers need a rapid assessment of defense efficacy. | **Mitigation Sliders:** Allow users to adjust a $\mathbf{\Delta V}$ (change in velocity) slider to see the $\mathbf{immediate\ impact}$ on the crater size and the orbital path animation. |
| **Engagement** | The tool needs to hold the user's attention and curiosity. | **Gamification:** Include a **"Defend Earth Mode"** where users race a timer to find the minimum $\Delta V$ needed to reduce the impact to a safe level. |

***

## 🛠️ Key Technical and Scientific Tools

| Tool/Concept | Purpose in AstroShield | Why It's Necessary |
| :--- | :--- | :--- |
| **Python/Flask** | Backend API to perform all the scientific math calculations and data mocking. | Necessary for scientific rigor and server-side logic before visualization. |
| **Three.js** | JavaScript library for the **3D visualization** of the asteroid's orbit. | Gives a dynamic, engaging view of the asteroid's path relative to Earth. |
| **Leaflet/D3.js** | JavaScript for the **2D impact map** and drawing the scale of the crater. | Essential for showing local, geo-referenced consequences and Tsunami risks. |
| **Kinetic Energy Formula** | $E_k = \frac{1}{2} m V_{\text{eff}}^2$ (mass $\times$ effective velocity squared). | The fundamental calculation that drives all impact consequence results. |
| **$\Delta V$ (Delta-V)** | The velocity change required to deflect the asteroid. | The core input parameter that simulates your defense strategy. |
