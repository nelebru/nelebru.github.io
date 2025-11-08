document.addEventListener("DOMContentLoaded", () => {
  const gpxList = document.getElementById("gpxList");
  const minDistanceInput = document.getElementById("minDistance");
  const maxDistanceInput = document.getElementById("maxDistance");
  const locationSelect = document.getElementById("locationFilter");
  const applyFilterBtn = document.getElementById("applyFilter");
  const resetFilterBtn = document.getElementById("resetFilter");

  let allCourses = [];

  // ------------------------------------------------------------
  // Load courses from JSON and render them
  // ------------------------------------------------------------
  async function loadCourses() {
    try {
      console.log('Loading courses from:', gpxJsonUrl);
      const response = await fetch(gpxJsonUrl);
      if (!response.ok) throw new Error("Failed to load GPX data");
      allCourses = await response.json();
      console.log('Courses loaded:', allCourses);

      setTimeout(() => renderCourses(allCourses), 50);
    } catch (error) {
      console.error("Error loading GPX data:", error);
      gpxList.innerHTML = "<p>Could not load GPX data.</p>";
    }
  }

  // ------------------------------------------------------------
  // Render all course cards
  // ------------------------------------------------------------
  function renderCourses(courses) {
    if (!courses || courses.length === 0) {
      gpxList.innerHTML = "<p>No courses found.</p>";
      return;
    }

    // Create cards with map placeholders
    gpxList.innerHTML = courses.map((course, index) => {
      const fileUrl = `${baseUrl}${course.file.startsWith("/") ? course.file : "/" + course.file}`;
      const fileName = course.name.toLowerCase().replace(/\s+/g, "-");
      const downloadName = `${fileName}_stolen-from-nele.gpx`;

      return `
        <div class="course-card">
          <div class="course-info">
            <h3>${course.name}</h3>
            <p><strong>Location:</strong> ${course.location}</p>
            <p><strong>Elevation gain:</strong> ${course.elevation_gain}</p>
            <p><strong>Distance:</strong> ${course.distance} km</p>
            <a href="${fileUrl}" download="${downloadName}" target="_blank">Download GPX</a>
          </div>
          <div id="map-${index}" class="course-map"></div>
        </div>
      `;
    }).join("");

    // Initialize maps after DOM update
    setTimeout(() => {
      courses.forEach((course, index) => {
        const fileUrl = `${baseUrl}${course.file.startsWith("/") ? course.file : "/" + course.file}`;
        initMap(`map-${index}`, fileUrl);
      });
    }, 100);
  }

  // ------------------------------------------------------------
  // Initialize one Leaflet map for a GPX course
  // ------------------------------------------------------------
  function initMap(mapId, gpxUrl) {
    console.log('=== initMap called ===');
    console.log('mapId:', mapId);
    console.log('gpxUrl:', gpxUrl);

    const mapEl = document.getElementById(mapId);
    console.log('mapEl found:', mapEl);

    if (!mapEl) {
      console.error('Map element not found:', mapId);
      return;
    }

    console.log('mapEl dimensions:', {
      width: mapEl.offsetWidth,
      height: mapEl.offsetHeight,
      clientWidth: mapEl.clientWidth,
      clientHeight: mapEl.clientHeight
    });

    // Check if Leaflet is loaded
    console.log('Leaflet available:', typeof L !== 'undefined');
    console.log('L.GPX available:', typeof L.GPX !== 'undefined');

    try {
      // Create Leaflet map
      const map = L.map(mapId, { scrollWheelZoom: false });
      console.log('Map created successfully:', map);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      console.log('Tile layer added');

      // Load the GPX file
      console.log('Loading GPX from:', gpxUrl);
      new L.GPX(gpxUrl, {
        async: true,
        marker_options: {
          startIconUrl: null,
          endIconUrl: null,
          shadowUrl: null,
        },
        polyline_options: {
          color: "#7b9acc",
          weight: 3,
          opacity: 0.8,
        },
      })
        .on("loaded", (e) => {
          console.log('GPX loaded successfully');
          map.fitBounds(e.target.getBounds());
          setTimeout(() => map.invalidateSize(), 200);
        })
        .on("error", (e) => {
          console.error('GPX loading error:', e);
        })
        .addTo(map);
    } catch (error) {
      console.error('Error creating map:', error);
    }
  }

  // ------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------
  function applyFilters() {
    const minDist = parseFloat(minDistanceInput.value) || 0;
    const maxDist = parseFloat(maxDistanceInput.value) || Infinity;
    const location = locationSelect.value;

    const filtered = allCourses.filter(c =>
      c.distance >= minDist &&
      c.distance <= maxDist &&
      (location === "" || c.location === location)
    );

    renderCourses(filtered);
  }

  function resetFilters() {
    minDistanceInput.value = "";
    maxDistanceInput.value = "";
    locationSelect.value = "";
    renderCourses(allCourses);
  }

  // ------------------------------------------------------------
  // Event listeners
  // ------------------------------------------------------------
  applyFilterBtn.addEventListener("click", applyFilters);
  resetFilterBtn.addEventListener("click", resetFilters);

  // ------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------
  loadCourses();
});
