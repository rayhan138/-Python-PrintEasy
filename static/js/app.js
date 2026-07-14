/**
 * PrintEasy — Main Application Logic
 * Orchestrates scanning, image management, template rendering, and printing.
 */

// ─── Application State ─────────────────────────────────────
const AppState = {
    scannedImages: [],          // Array of {id, label, originalSrc, processedCanvas, rotation}
    selectedImageId: null,      // Currently selected image ID
    placements: [],             // Array of {id, label, x, y, width, height, imageIndex, imageEntry}
    selectedPlacementId: null,  // Currently selected placement ID
    currentTemplate: '2x-front-back',
    currentPaperSize: 'A4',
    currentOrientation: 'landscape',
    scannersList: [],
    printersList: [],
    isScanning: false,
    imageCounter: 0,
};

// ─── Interaction State ─────────────────────────────────────
let isDragging = false;
let isResizing = false;
let startX = 0;
let startY = 0;
let startPlacementX = 0;
let startPlacementY = 0;
let startPlacementW = 0;
let startPlacementH = 0;


// ─── Initialization ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // Fetch scanners and printers in parallel
    await Promise.allSettled([
        loadScanners(),
        loadPrinters()
    ]);

    // Setup interactive events on page overlay
    setupOverlayEvents();
    setupSliderWheelEvents();
    setupKeyboardShortcuts();

    // Set initial page size
    updatePagePreview();
    applyTemplate();
}


// ─── Scanner Management ─────────────────────────────────────

async function loadScanners() {
    const select = document.getElementById('scannerSelect');
    const statusEl = document.getElementById('scannerStatus');

    try {
        const response = await fetch('/api/scanners');
        const data = await response.json();

        if (data.success && data.scanners.length > 0) {
            AppState.scannersList = data.scanners;
            select.innerHTML = data.scanners.map(s =>
                `<option value="${s.id}">${s.name}</option>`
            ).join('');

            statusEl.querySelector('.status-dot').className = 'status-dot connected';
            statusEl.querySelector('.status-text').textContent = `${data.scanners[0].name}`;
        } else {
            select.innerHTML = '<option value="">No scanner found</option>';
            statusEl.querySelector('.status-dot').className = 'status-dot disconnected';
            statusEl.querySelector('.status-text').textContent = 'No scanner detected';
        }
    } catch (e) {
        select.innerHTML = '<option value="">Connection error</option>';
        statusEl.querySelector('.status-dot').className = 'status-dot disconnected';
        statusEl.querySelector('.status-text').textContent = 'Server not connected';
        console.error('Failed to load scanners:', e);
    }
}


// ─── Printer Management ─────────────────────────────────────

async function loadPrinters() {
    const select = document.getElementById('printerSelect');

    try {
        const printers = await PrintManager.fetchPrinters();
        AppState.printersList = printers;

        if (printers.length > 0) {
            select.innerHTML = printers.map(p =>
                `<option value="${p.name}" ${p.is_default ? 'selected' : ''}>${p.name}</option>`
            ).join('');
        } else {
            select.innerHTML = '<option value="">No printer found</option>';
        }
    } catch (e) {
        select.innerHTML = '<option value="">Connection error</option>';
        console.error('Failed to load printers:', e);
    }
}


// ─── Scan Handler ───────────────────────────────────────────

async function handleScan() {
    if (AppState.isScanning) return;

    const scannerId = document.getElementById('scannerSelect').value;
    const dpi = parseInt(document.getElementById('dpiSelect').value);
    const statusEl = document.getElementById('scannerStatus');

    AppState.isScanning = true;
    showLoading('Scanning...');
    statusEl.querySelector('.status-dot').className = 'status-dot scanning';
    try {
        const colorMode = document.getElementById('colorModeSelect').value;

        const response = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scanner_id: scannerId || null,
                dpi: dpi,
                grayscale: colorMode
            })
        });

        const data = await response.json();

        if (data.success) {
            await addScannedImage(data.image, `Scan ${AppState.imageCounter + 1}`, colorMode === 'bw');
            showToast('Scan complete!', 'success');
            openCropModal();
        } else {
            showToast(data.error || 'Scan failed', 'error');
        }
    } catch (e) {
        showToast('Could not connect to scanner. Is the server running?', 'error');
        console.error('Scan error:', e);
    } finally {
        AppState.isScanning = false;
        hideLoading();
        statusEl.querySelector('.status-dot').className = 'status-dot connected';
    }
}


// ─── Upload Handler ─────────────────────────────────────────

async function handleUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            showToast(`${file.name} is not an image file`, 'warning');
            continue;
        }

        showLoading('Processing image...');

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                addScannedImage(data.image, file.name.split('.')[0]);
                showToast('Image loaded!', 'success');
            } else {
                showToast(data.error || 'Upload failed', 'error');
            }
        } catch (e) {
            // Fallback: load image directly in browser
            try {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    addScannedImage(ev.target.result, file.name.split('.')[0]);
                    showToast('Image loaded locally', 'success');
                };
                reader.readAsDataURL(file);
            } catch (e2) {
                showToast('Failed to load image', 'error');
            }
        }
    }

    hideLoading();
    event.target.value = ''; // Reset file input
}


// ─── Scanned Image Management ───────────────────────────────

async function addScannedImage(imageSrc, label, isHardwareBW = false) {
    const id = ++AppState.imageCounter;
    const img = await ImageProcessor.loadImage(imageSrc);

    const entry = {
        id: id,
        label: label || `Image ${id}`,
        originalSrc: imageSrc,
        originalImg: img,
        processedCanvas: null,
        rotation: 0,
        crop: null,
        brightness: parseInt(document.getElementById('brightnessSlider').value),
        contrast: parseInt(document.getElementById('contrastSlider').value),
        threshold: 0 // Default to Off (0) until explicitly enabled!
    };

    // Process image with current settings
    entry.processedCanvas = processImage(entry);

    AppState.scannedImages.push(entry);

    // Auto-label for front/back workflow
    if (AppState.currentTemplate === 'front-back' || AppState.currentTemplate === '2x-front-back') {
        const count = AppState.scannedImages.length;
        if (count === 1) entry.label = 'Front Side';
        else if (count === 2) entry.label = 'Back Side';
    }

    // Slot assignment logic:
    // 1. If a slot is currently selected, assign to it
    let assigned = false;
    let assignedImageIndex = null;
    if (AppState.selectedPlacementId !== null) {
        const placement = AppState.placements.find(p => p.id === AppState.selectedPlacementId);
        if (placement) {
            placement.imageEntry = entry;
            const aspect = entry.processedCanvas.width / entry.processedCanvas.height;
            placement.height = placement.width / aspect;
            assignedImageIndex = placement.imageIndex;
            assigned = true;
        }
    }
    
    // 2. If no slot was selected, assign to the first empty slot
    if (!assigned) {
        const emptyPlacement = AppState.placements.find(p => p.imageEntry === null);
        if (emptyPlacement) {
            emptyPlacement.imageEntry = entry;
            const aspect = entry.processedCanvas.width / entry.processedCanvas.height;
            emptyPlacement.height = emptyPlacement.width / aspect;
            AppState.selectedPlacementId = emptyPlacement.id;
            assignedImageIndex = emptyPlacement.imageIndex;
            assigned = true;
        }
    }

    // 3. Auto-fill other zones with the same imageIndex (for 2x templates)
    //    This way scanning front+back (2 images) fills all 4 zones automatically
    if (assigned && assignedImageIndex !== null) {
        AppState.placements.forEach(p => {
            if (p.imageIndex === assignedImageIndex && p.imageEntry === null) {
                p.imageEntry = entry;
                const aspect = entry.processedCanvas.width / entry.processedCanvas.height;
                p.height = p.width / aspect;
            }
        });
    }

    // Select the new image & sync sliders (this sets threshold to 0/Off for hardware B&W)
    selectScannedImage(id);
    updatePrintButton();
}

function removeScannedImage(id) {
    // 1. Remove from scanned list
    AppState.scannedImages = AppState.scannedImages.filter(img => img.id !== id);

    // 2. Clear any slots referencing this image
    AppState.placements.forEach(p => {
        if (p.imageEntry && p.imageEntry.id === id) {
            p.imageEntry = null;
        }
    });

    if (AppState.selectedImageId === id) {
        AppState.selectedImageId = AppState.scannedImages.length > 0
            ? AppState.scannedImages[AppState.scannedImages.length - 1].id
            : null;
    }

    renderScannedImagesList();
    showImageControls(AppState.scannedImages.length > 0);
    renderPagePreview(); // Redraw preview
    updatePrintButton();
}

function selectScannedImage(id) {
    AppState.selectedImageId = id;
    renderScannedImagesList();
    showImageControls(true);

    // Sync sliders to this specific image's settings
    const entry = AppState.scannedImages.find(img => img.id === id);
    if (entry) {
        document.getElementById('brightnessSlider').value = entry.brightness;
        document.getElementById('contrastSlider').value = entry.contrast;

        const toggle = document.getElementById('thresholdToggle');
        const slider = document.getElementById('thresholdSlider');
        const presetsDiv = document.getElementById('thresholdPresets');

        if (entry.threshold === 0) {
            if (toggle) toggle.checked = false;
            if (slider) slider.disabled = true;
            if (presetsDiv) {
                const buttons = presetsDiv.getElementsByTagName('button');
                for (let btn of buttons) btn.disabled = true;
            }
            document.getElementById('thresholdValue').textContent = 'Off';
        } else {
            if (toggle) toggle.checked = true;
            if (slider) {
                slider.disabled = false;
                slider.value = entry.threshold;
            }
            if (presetsDiv) {
                const buttons = presetsDiv.getElementsByTagName('button');
                for (let btn of buttons) btn.disabled = false;
            }
            document.getElementById('thresholdValue').textContent = entry.threshold;
        }

        document.getElementById('brightnessValue').textContent = entry.brightness;
        document.getElementById('contrastValue').textContent = entry.contrast;

        // If a slot is selected, load/assign this image into it
        if (AppState.selectedPlacementId !== null) {
            const placement = AppState.placements.find(p => p.id === AppState.selectedPlacementId);
            if (placement) {
                placement.imageEntry = entry;
                const aspect = entry.processedCanvas.width / entry.processedCanvas.height;
                placement.height = placement.width / aspect;
            }
        }
    }

    renderPagePreview();
}

function renderScannedImagesList() {
    const container = document.getElementById('scannedImages');
    const emptyState = document.getElementById('emptyState');

    if (AppState.scannedImages.length === 0) {
        container.innerHTML = '';
        container.appendChild(emptyState);
        emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = AppState.scannedImages.map(img => {
        const thumbSrc = img.processedCanvas
            ? img.processedCanvas.toDataURL('image/jpeg', 0.5)
            : img.originalSrc;

        const isSelected = img.id === AppState.selectedImageId;

        return `
            <div class="scanned-item ${isSelected ? 'selected' : ''}" 
                 onclick="selectScannedImage(${img.id})" data-id="${img.id}">
                <img class="scanned-item-thumb" src="${thumbSrc}" alt="${img.label}">
                <div class="scanned-item-info">
                    <div class="scanned-item-label">${img.label}</div>
                    <div class="scanned-item-meta">${img.originalImg.naturalWidth}×${img.originalImg.naturalHeight}px</div>
                </div>
                <div class="scanned-item-actions">
                    <button class="scanned-item-btn" onclick="event.stopPropagation(); duplicateScannedImage(${img.id})" title="Duplicate">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                        </svg>
                    </button>
                    <button class="scanned-item-btn remove" onclick="event.stopPropagation(); removeScannedImage(${img.id})" title="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}


// ─── Image Processing ───────────────────────────────────────

function processImage(entry) {
    let source = entry.originalImg;

    // Apply crop if defined
    if (entry.crop) {
        if (entry.crop.type === 'perspective') {
            // Apply perspective warp crop!
            source = warpPerspective(source, entry.crop.points, entry.crop.width, entry.crop.height);
        } else {
            // Standard rectangular crop
            const cropCanvas = document.createElement('canvas');
            const cropCtx = cropCanvas.getContext('2d');
            cropCanvas.width = entry.crop.width;
            cropCanvas.height = entry.crop.height;
            cropCtx.drawImage(
                source,
                entry.crop.x, entry.crop.y, entry.crop.width, entry.crop.height,
                0, 0, entry.crop.width, entry.crop.height
            );
            source = cropCanvas;
        }
    }

    // Apply rotation if any
    if (entry.rotation !== 0) {
        source = ImageProcessor.rotate(source, entry.rotation);
    }

    // Apply grayscale + adjustments specific to this entry
    return ImageProcessor.processToGrayscale(source, {
        brightness: entry.brightness,
        contrast: entry.contrast,
        threshold: entry.threshold
    });
}

function updateImageProcessing() {
    const entry = AppState.scannedImages.find(img => img.id === AppState.selectedImageId);
    if (!entry) return;

    // Read values
    const brightness = parseInt(document.getElementById('brightnessSlider').value);
    const contrast = parseInt(document.getElementById('contrastSlider').value);
    
    const toggle = document.getElementById('thresholdToggle');
    const threshold = (toggle && toggle.checked) 
        ? parseInt(document.getElementById('thresholdSlider').value) 
        : 0;

    // Update slider text display
    document.getElementById('brightnessValue').textContent = brightness;
    document.getElementById('contrastValue').textContent = contrast;
    document.getElementById('thresholdValue').textContent = threshold === 0 ? 'Off' : threshold;

    // Save settings to this specific image entry
    entry.brightness = brightness;
    entry.contrast = contrast;
    entry.threshold = threshold;

    // Reprocess only this image
    entry.processedCanvas = processImage(entry);

    syncPlacementsWithImages();

    // Update UI
    renderScannedImagesList();
    renderPagePreview();
}

function rotateSelected(degrees) {
    const entry = AppState.scannedImages.find(img => img.id === AppState.selectedImageId);
    if (!entry) return;

    entry.rotation = (entry.rotation + degrees + 360) % 360;
    entry.processedCanvas = processImage(entry);

    syncPlacementsWithImages();

    renderScannedImagesList();
    renderPagePreview();
    showToast(`Rotated ${degrees > 0 ? 'right' : 'left'}`, 'info');
}

function deleteSelected() {
    if (AppState.selectedImageId) {
        removeScannedImage(AppState.selectedImageId);
    }
}


// ─── Drag & Drop / Resize Event Handlers ──────────────────────

function setupOverlayEvents() {
    const overlay = document.getElementById('pageOverlay');
    overlay.style.pointerEvents = 'auto'; // Enable receiving click/drag

    overlay.addEventListener('mousedown', handleMouseDown);
    overlay.addEventListener('touchstart', handleTouchStart, { passive: false });
    overlay.addEventListener('wheel', handleOverlayWheel, { passive: false });

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleTouchEnd);
}

function handleOverlayWheel(e) {
    if (AppState.selectedPlacementId !== null) {
        e.preventDefault(); // Prevent full webpage scroll
        // Zoom in by 3% (+0.03) or zoom out by 3% (-0.03)
        const factor = e.deltaY < 0 ? 0.03 : -0.03;
        zoomSelected(factor);
    }
}

function startInteraction(e, clientX, clientY) {
    const isHandle = e.target.classList.contains('resize-handle');
    const box = e.target.closest('.template-zone');

    if (!box) {
        AppState.selectedPlacementId = null;
        renderPagePreview();
        return;
    }

    const id = parseInt(box.dataset.id);
    AppState.selectedPlacementId = id;

    const placement = AppState.placements.find(p => p.id === id);
    if (!placement) return;

    // Select the associated scanned image too
    if (placement.imageEntry) {
        AppState.selectedImageId = placement.imageEntry.id;
        renderScannedImagesList();
        showImageControls(true);
    }

    const container = document.getElementById('pageContainer');
    const dims = Templates.getPageDimensions(AppState.currentPaperSize, AppState.currentOrientation);
    const mmScale = dims.width / container.clientWidth;

    startX = clientX;
    startY = clientY;
    startPlacementX = placement.x;
    startPlacementY = placement.y;
    startPlacementW = placement.width;
    startPlacementH = placement.height;

    if (isHandle) {
        isResizing = true;
        e.stopPropagation();
    } else {
        isDragging = true;
    }

    e.preventDefault();
    renderPagePreview();
}

function handleMouseDown(e) {
    startInteraction(e, e.clientX, e.clientY);
}

function handleTouchStart(e) {
    if (e.touches.length > 0) {
        startInteraction(e, e.touches[0].clientX, e.touches[0].clientY);
    }
}

function moveInteraction(e, clientX, clientY) {
    if (!isDragging && !isResizing) return;
    if (AppState.selectedPlacementId === null) return;

    const placement = AppState.placements.find(p => p.id === AppState.selectedPlacementId);
    if (!placement) return;

    const container = document.getElementById('pageContainer');
    const dims = Templates.getPageDimensions(AppState.currentPaperSize, AppState.currentOrientation);
    const mmScale = dims.width / container.clientWidth;

    const dx = (clientX - startX) * mmScale;
    const dy = (clientY - startY) * mmScale;

    if (isDragging) {
        let newX = startPlacementX + dx;
        let newY = startPlacementY + dy;

        // Keep at least 20mm of the image visible inside page width/height so it never gets lost
        const minVisible = 20; 
        newX = Math.max(-placement.width + minVisible, Math.min(dims.width - minVisible, newX));
        newY = Math.max(-placement.height + minVisible, Math.min(dims.height - minVisible, newY));

        placement.x = newX;
        placement.y = newY;
    } else if (isResizing) {
        const aspect = placement.imageEntry
            ? (placement.imageEntry.processedCanvas ? placement.imageEntry.processedCanvas.width / placement.imageEntry.processedCanvas.height : 85.6/54)
            : (85.6 / 54);

        const newW = startPlacementW + dx;
        placement.width = Math.max(10, Math.min(500, newW)); // constrain size between 10mm and 500mm
        placement.height = placement.width / aspect;
    }

    renderPagePreview();
}

function handleMouseMove(e) {
    moveInteraction(e, e.clientX, e.clientY);
}

function handleTouchMove(e) {
    if (e.touches.length > 0) {
        moveInteraction(e, e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
    }
}

function stopInteraction() {
    isDragging = false;
    isResizing = false;
}

function handleMouseUp() {
    stopInteraction();
}

function handleTouchEnd() {
    stopInteraction();
}


// ─── Button-Based Zoom & Reset Controls ───────────────────────

function zoomSelected(factor) {
    if (AppState.selectedPlacementId === null) return;
    const placement = AppState.placements.find(p => p.id === AppState.selectedPlacementId);
    if (!placement) return;

    const aspect = placement.imageEntry
        ? (placement.imageEntry.processedCanvas ? placement.imageEntry.processedCanvas.width / placement.imageEntry.processedCanvas.height : 85.6/54)
        : (85.6 / 54);

    // Save previous dimensions to compute center shift
    const oldW = placement.width;
    const oldH = placement.height;

    // Enlarge or shrink by factor, bounded between 10mm and 500mm
    const newW = Math.max(10, Math.min(500, placement.width * (1 + factor)));
    const newH = newW / aspect;

    // Shift x/y coordinates so zooming remains centered (like Canva.com)
    placement.x = placement.x - (newW - oldW) / 2;
    placement.y = placement.y - (newH - oldH) / 2;

    placement.width = newW;
    placement.height = newH;

    renderPagePreview();
}

function resetSelectedPlacement() {
    if (AppState.selectedPlacementId === null) return;

    const template = Templates.getTemplate(
        AppState.currentTemplate,
        AppState.currentPaperSize,
        AppState.currentOrientation
    );

    const zone = template.zones[AppState.selectedPlacementId];
    const placement = AppState.placements.find(p => p.id === AppState.selectedPlacementId);

    if (zone && placement) {
        placement.x = zone.x;
        placement.y = zone.y;
        placement.width = zone.width;
        placement.height = zone.height;
        renderPagePreview();
        showToast('Reset position & size', 'info');
    }
}


// ─── Template & Page Management ─────────────────────────────

function handleCopiesToggle(isFourCopies) {
    const select = document.getElementById('templateSelect');
    if (isFourCopies) {
        select.value = '2x-front-back';
    } else {
        select.value = 'front-back';
    }
    applyTemplate();
}

function applyTemplate() {
    AppState.currentTemplate = document.getElementById('templateSelect').value;

    const template = Templates.getTemplate(
        AppState.currentTemplate,
        AppState.currentPaperSize,
        AppState.currentOrientation
    );

    const oldPlacements = AppState.placements;

    // Populate active placements preserving previous assignments
    AppState.placements = [];
    template.zones.forEach((zone, index) => {
        const oldPlacement = oldPlacements.find(p => p.id === index);
        let imageEntry = null;

        if (oldPlacement && oldPlacement.imageEntry) {
            const exists = AppState.scannedImages.some(img => img.id === oldPlacement.imageEntry.id);
            if (exists) {
                imageEntry = oldPlacement.imageEntry;
            }
        }

        if (!imageEntry) {
            imageEntry = AppState.scannedImages[zone.imageIndex] || null;
        }

        AppState.placements.push({
            id: index,
            label: zone.label,
            x: zone.x,
            y: zone.y,
            width: zone.width,
            height: zone.height,
            imageIndex: zone.imageIndex,
            imageEntry: imageEntry
        });
    });

    renderPagePreview();
}

function syncPlacementsWithImages() {
    AppState.placements.forEach(placement => {
        const imageEntry = AppState.scannedImages[placement.imageIndex];
        if (imageEntry) {
            placement.imageEntry = imageEntry;
            const aspect = imageEntry.processedCanvas.width / imageEntry.processedCanvas.height;
            placement.height = placement.width / aspect;
        } else {
            placement.imageEntry = null;
        }
    });
}

function changePaperSize() {
    AppState.currentPaperSize = document.getElementById('paperSelect').value;
    updatePagePreview();
    applyTemplate();
}

function setOrientation(orientation) {
    AppState.currentOrientation = orientation;

    document.getElementById('btnPortrait').dataset.active = orientation === 'portrait';
    document.getElementById('btnLandscape').dataset.active = orientation === 'landscape';

    updatePagePreview();
    applyTemplate();
}

function updatePagePreview() {
    const container = document.getElementById('pageContainer');
    const dims = Templates.getPageDimensions(AppState.currentPaperSize, AppState.currentOrientation);

    // Scale to fit preview area (max ~500px on longest side)
    const maxSize = 500;
    const scale = Math.min(maxSize / dims.width, maxSize / dims.height);

    container.style.width = Math.round(dims.width * scale) + 'px';
    container.style.height = Math.round(dims.height * scale) + 'px';

    // Update canvas resolution
    const canvas = document.getElementById('pageCanvas');
    canvas.width = Math.round(dims.width * scale * 2); // 2x for retina
    canvas.height = Math.round(dims.height * scale * 2);
}


// ─── Page Preview Rendering ─────────────────────────────────

function renderPagePreview() {
    const canvas = document.getElementById('pageCanvas');
    const ctx = canvas.getContext('2d');
    const overlay = document.getElementById('pageOverlay');
    const pageEmpty = document.getElementById('pageEmpty');

    const dims = Templates.getPageDimensions(AppState.currentPaperSize, AppState.currentOrientation);

    // Scale factors for canvas rendering
    const scaleX = canvas.width / dims.width;
    const scaleY = canvas.height / dims.height;

    // Scale factors for overlay (CSS pixels)
    const container = document.getElementById('pageContainer');
    const overlayScaleX = container.clientWidth / dims.width;
    const overlayScaleY = container.clientHeight / dims.height;

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Track if we have any images placed
    let hasImages = false;

    // Clear previous overlay items
    overlay.innerHTML = '';

    // Draw active placements
    AppState.placements.forEach((placement) => {
        const imageEntry = placement.imageEntry;
        const isSelected = placement.id === AppState.selectedPlacementId;

        // Render DOM helper element in overlay
        const zoneEl = document.createElement('div');
        zoneEl.className = 'template-zone' + (imageEntry ? ' filled' : '') + (isSelected ? ' selected' : '');
        zoneEl.dataset.id = placement.id;
        zoneEl.style.left = (placement.x * overlayScaleX) + 'px';
        zoneEl.style.top = (placement.y * overlayScaleY) + 'px';
        zoneEl.style.width = (placement.width * overlayScaleX) + 'px';
        zoneEl.style.height = (placement.height * overlayScaleY) + 'px';

        if (!imageEntry) {
            zoneEl.innerHTML = `<span class="template-zone-label">${placement.label}</span>`;
        } else {
            // Draw resize handle and rotation button if selected
            if (isSelected) {
                const handle = document.createElement('div');
                handle.className = 'resize-handle';
                zoneEl.appendChild(handle);

                // Add a rotate button directly on the preview zone!
                const rotateBtn = document.createElement('button');
                rotateBtn.className = 'preview-rotate-btn';
                rotateBtn.title = 'Rotate 90°';
                rotateBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/>
                    </svg>
                `;
                // Prevent drag events from triggering when interacting with this button
                rotateBtn.addEventListener('mousedown', (e) => e.stopPropagation());
                rotateBtn.addEventListener('touchstart', (e) => e.stopPropagation());
                rotateBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    rotateSelected(90);
                });
                zoneEl.appendChild(rotateBtn);
            }
        }
        overlay.appendChild(zoneEl);

        // Draw image on canvas if available
        if (imageEntry && imageEntry.processedCanvas) {
            hasImages = true;
            const source = imageEntry.processedCanvas;

            const dx = placement.x * scaleX;
            const dy = placement.y * scaleY;
            const dw = placement.width * scaleX;
            const dh = placement.height * scaleY;

            ctx.drawImage(source, 0, 0, source.width, source.height, dx, dy, dw, dh);
        }
    });

    // Draw center divider line for 2x templates (A5 boundary on A4)
    const currentTemplate = Templates.getTemplate(
        AppState.currentTemplate,
        AppState.currentPaperSize,
        AppState.currentOrientation
    );
    if (currentTemplate.showCenterLine) {
        const centerX = dims.width / 2;

        // Draw on canvas (dashed line)
        ctx.save();
        ctx.setLineDash([8, 5]);
        ctx.strokeStyle = '#b0b0b0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(centerX * scaleX, 0);
        ctx.lineTo(centerX * scaleX, canvas.height);
        ctx.stroke();
        ctx.restore();

        // Add visual overlay divider
        const dividerLine = document.createElement('div');
        dividerLine.className = 'page-center-divider';
        dividerLine.style.left = (centerX * overlayScaleX) + 'px';
        dividerLine.style.top = '0';
        dividerLine.style.height = '100%';
        overlay.appendChild(dividerLine);

        // Add A5 labels
        const leftLabel = document.createElement('div');
        leftLabel.className = 'a5-half-label';
        leftLabel.textContent = 'A5';
        leftLabel.style.left = (centerX * overlayScaleX / 2) + 'px';
        leftLabel.style.bottom = '4px';
        overlay.appendChild(leftLabel);

        const rightLabel = document.createElement('div');
        rightLabel.className = 'a5-half-label';
        rightLabel.textContent = 'A5';
        rightLabel.style.left = (centerX * overlayScaleX + centerX * overlayScaleX / 2) + 'px';
        rightLabel.style.bottom = '4px';
        overlay.appendChild(rightLabel);
    }

    // Show/hide empty state
    pageEmpty.style.display = hasImages ? 'none' : 'flex';
}


// ─── Print Handler ──────────────────────────────────────────

async function handlePrint() {
    if (AppState.scannedImages.length === 0) {
        showToast('No images to print. Scan or upload first.', 'warning');
        return;
    }

    const printerName = document.getElementById('printerSelect').value;
    const copies = parseInt(document.getElementById('copiesInput').value) || 1;
    const printMode = document.getElementById('printModeSelect').value;

    showLoading('Sending to printer...');

    try {
        // Compose the final page at full DPI
        const composedCanvas = composeFullResPage();

        // Try direct printing via server
        const result = await PrintManager.printDirect(composedCanvas, {
            printerName: printerName || null,
            copies: copies,
            paperSize: AppState.currentPaperSize,
            printMode: printMode
        });

        if (result.success) {
            showToast(result.message, 'success');
        } else {
            // Fallback to browser print
            showToast('Direct print failed. Opening browser print dialog...', 'warning');
            PrintManager.printViaBrowser(composedCanvas, AppState.currentPaperSize);
        }
    } catch (e) {
        console.error('Print error:', e);
        // Fallback to browser print
        try {
            const composedCanvas = composeFullResPage();
            PrintManager.printViaBrowser(composedCanvas, AppState.currentPaperSize);
            showToast('Opened browser print dialog', 'info');
        } catch (e2) {
            showToast('Print failed: ' + e2.message, 'error');
        }
    } finally {
        hideLoading();
    }
}

function handleSavePDF() {
    if (AppState.scannedImages.length === 0) {
        showToast('No images to save. Scan or upload first.', 'warning');
        return;
    }

    const composedCanvas = composeFullResPage();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    PrintManager.saveAsImage(composedCanvas, `PrintEasy_${timestamp}.png`);
    showToast('Image saved!', 'success');
}


// ─── Full Resolution Composition ────────────────────────────

function composeFullResPage() {
    const dims = Templates.getPageDimensions(AppState.currentPaperSize, AppState.currentOrientation);

    // Build placements array
    const placements = [];
    AppState.placements.forEach((placement) => {
        const imageEntry = placement.imageEntry;
        if (imageEntry && imageEntry.processedCanvas) {
            placements.push({
                image: imageEntry.processedCanvas,
                x: placement.x,
                y: placement.y,
                width: placement.width,
                height: placement.height
            });
        }
    });

    const composedCanvas = ImageProcessor.composePage({
        pageWidthMM: dims.width,
        pageHeightMM: dims.height,
        dpi: 300,
        placements
    });

    // Draw center divider line on printed output for cutting guide
    const currentTemplate = Templates.getTemplate(
        AppState.currentTemplate,
        AppState.currentPaperSize,
        AppState.currentOrientation
    );
    if (currentTemplate.showCenterLine) {
        const ctx = composedCanvas.getContext('2d');
        const centerX = composedCanvas.width / 2;

        ctx.save();
        ctx.setLineDash([20, 12]);
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, composedCanvas.height);
        ctx.stroke();
        ctx.restore();
    }

    return composedCanvas;
}


// ─── UI Helpers ─────────────────────────────────────────────

function showImageControls(show) {
    document.getElementById('imageControlsSection').style.display = show ? 'block' : 'none';
}

function updatePrintButton() {
    const btn = document.getElementById('btnPrint');
    btn.disabled = AppState.scannedImages.length === 0;
}

function adjustCopies(delta) {
    const input = document.getElementById('copiesInput');
    const newVal = Math.max(1, Math.min(99, parseInt(input.value) + delta));
    input.value = newVal;
}

function resetAll() {
    AppState.scannedImages = [];
    AppState.selectedImageId = null;
    AppState.selectedPlacementId = null;
    AppState.placements = [];
    AppState.imageCounter = 0;

    // Reset sliders
    document.getElementById('brightnessSlider').value = 0;
    document.getElementById('contrastSlider').value = 0;
    
    const toggle = document.getElementById('thresholdToggle');
    const slider = document.getElementById('thresholdSlider');
    const presetsDiv = document.getElementById('thresholdPresets');
    
    if (toggle) toggle.checked = false;
    if (slider) {
        slider.value = 128;
        slider.disabled = true;
    }
    if (presetsDiv) {
        const buttons = presetsDiv.getElementsByTagName('button');
        for (let btn of buttons) btn.disabled = true;
    }
    
    document.getElementById('brightnessValue').textContent = '0';
    document.getElementById('contrastValue').textContent = '0';
    document.getElementById('thresholdValue').textContent = 'Off';

    // Reset copies
    document.getElementById('copiesInput').value = 1;

    // Update UI
    renderScannedImagesList();
    showImageControls(false);
    applyTemplate();
    updatePrintButton();

    showToast('Reset complete', 'info');
}


// ─── Toast Notifications ────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}


// ─── Loading Overlay ────────────────────────────────────────

function showLoading(text = 'Processing...') {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').textContent = text;
    overlay.classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}


// ─── Perspective Warp Transformation (Homography Solver) ──────

function solveLinearSystem(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
        let maxEl = Math.abs(A[i][i]);
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(A[k][i]) > maxEl) {
                maxEl = Math.abs(A[k][i]);
                maxRow = k;
            }
        }
        for (let k = i; k < n; k++) {
            const tmp = A[maxRow][k];
            A[maxRow][k] = A[i][k];
            A[i][k] = tmp;
        }
        const tmp = b[maxRow];
        b[maxRow] = b[i];
        b[i] = tmp;

        for (let k = i + 1; k < n; k++) {
            const c = -A[k][i] / A[i][i];
            for (let j = i; j < n; j++) {
                if (i === j) {
                    A[k][j] = 0;
                } else {
                    A[k][j] += c * A[i][j];
                }
            }
            b[k] += c * b[i];
        }
    }

    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = b[i] / A[i][i];
        for (let k = i - 1; k >= 0; k--) {
            b[k] -= A[k][i] * x[i];
        }
    }
    return x;
}

function getHomographyCoefficients(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
        const sx = src[i].x;
        const sy = src[i].y;
        const dx = dst[i].x;
        const dy = dst[i].y;
        A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
        b.push(dx);
        A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
        b.push(dy);
    }
    const c = solveLinearSystem(A, b);
    return [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], 1.0];
}

function warpPerspective(srcImg, srcPoints, dstWidth, dstHeight) {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcImg.naturalWidth || srcImg.width;
    srcCanvas.height = srcImg.naturalHeight || srcImg.height;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(srcImg, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const srcPixels = srcData.data;
    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = dstWidth;
    dstCanvas.height = dstHeight;
    const dstCtx = dstCanvas.getContext('2d');
    const dstData = dstCtx.createImageData(dstWidth, dstHeight);
    const dstPixels = dstData.data;

    const dstPoints = [
        { x: 0, y: 0 },
        { x: dstWidth, y: 0 },
        { x: dstWidth, y: dstHeight },
        { x: 0, y: dstHeight }
    ];

    // Compute mapping from DST to SRC for backward mapping
    const h = getHomographyCoefficients(dstPoints, srcPoints);

    for (let y = 0; y < dstHeight; y++) {
        for (let x = 0; x < dstWidth; x++) {
            const w = h[6] * x + h[7] * y + h[8];
            const sx = Math.round((h[0] * x + h[1] * y + h[2]) / w);
            const sy = Math.round((h[3] * x + h[4] * y + h[5]) / w);
            const dstIdx = (y * dstWidth + x) * 4;

            if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
                const srcIdx = (sy * srcW + sx) * 4;
                dstPixels[dstIdx] = srcPixels[srcIdx];
                dstPixels[dstIdx + 1] = srcPixels[srcIdx + 1];
                dstPixels[dstIdx + 2] = srcPixels[srcIdx + 2];
                dstPixels[dstIdx + 3] = srcPixels[srcIdx + 3];
            } else {
                dstPixels[dstIdx] = 255;
                dstPixels[dstIdx + 1] = 255;
                dstPixels[dstIdx + 2] = 255;
                dstPixels[dstIdx + 3] = 255;
            }
        }
    }
    dstCtx.putImageData(dstData, 0, 0);
    return dstCanvas;
}


// ─── Slider Scroll Wheel & Presets ────────────────────────────

function setupSliderWheelEvents() {
    const sliders = ['brightnessSlider', 'contrastSlider', 'thresholdSlider'];
    sliders.forEach(id => {
        const slider = document.getElementById(id);
        if (slider) {
            slider.addEventListener('wheel', (e) => {
                e.preventDefault();
                const step = parseInt(slider.step) || 1;
                const min = parseInt(slider.min) || 0;
                const max = parseInt(slider.max) || 255;
                const val = parseInt(slider.value);
                
                const delta = e.deltaY < 0 ? step * 2 : -step * 2;
                const newVal = Math.max(min, Math.min(max, val + delta));
                
                slider.value = newVal;
                updateImageProcessing();
            }, { passive: false });
        }
    });
}

function setThresholdPreset(val) {
    const toggle = document.getElementById('thresholdToggle');
    const slider = document.getElementById('thresholdSlider');
    const presetsDiv = document.getElementById('thresholdPresets');
    
    if (toggle && slider) {
        toggle.checked = true;
        slider.disabled = false;
        slider.value = val;
        
        if (presetsDiv) {
            const buttons = presetsDiv.getElementsByTagName('button');
            for (let btn of buttons) btn.disabled = false;
        }
        
        updateImageProcessing();
    }
}

function handleThresholdToggle(checked) {
    const slider = document.getElementById('thresholdSlider');
    if (slider) slider.disabled = !checked;
    
    const presetsDiv = document.getElementById('thresholdPresets');
    if (presetsDiv) {
        const buttons = presetsDiv.getElementsByTagName('button');
        for (let btn of buttons) btn.disabled = !checked;
    }
    
    updateImageProcessing();
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        // Ignore if focus is in an input or textarea
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable) {
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (AppState.selectedImageId !== null) {
                e.preventDefault();
                deleteSelected();
                showToast('Deleted selected image', 'info');
            }
        }
    });
}


// ─── Crop Selection Modal Handlers ────────────────────────────

// Crop Modal state
let cropMode = 'standard'; // 'standard' or 'perspective'
let perspectivePoints = []; // [{x, y}, ...] in base coordinate space
let cropBox = { x1: 0, y1: 0, x2: 0, y2: 0 }; // in base coordinate space
let activeHandle = null; // 'TL', 'TR', 'BL', 'BR', 'MOVE', 'NEW', or index 0-3 for perspective
let moveOffsetX = 0;
let moveOffsetY = 0;
let boxWidth = 0;
let boxHeight = 0;
let isCropping = false;
let cropScale = 1.0;
let modalZoom = 1.0;

function adjustCropZoom(delta) {
    const newZoom = Math.max(0.5, Math.min(4.0, modalZoom + delta));
    if (newZoom === modalZoom) return;

    modalZoom = newZoom;

    // Update zoom label
    document.getElementById('cropZoomLabel').textContent = Math.round(modalZoom * 100) + '%';

    // Resize canvas to scaled size
    const canvas = document.getElementById('cropCanvas');
    const entry = AppState.scannedImages.find(img => img.id === AppState.selectedImageId);
    if (!entry) return;

    const img = entry.originalImg;
    canvas.width = img.naturalWidth * cropScale * modalZoom;
    canvas.height = img.naturalHeight * cropScale * modalZoom;

    drawCropOverlay();
}

function setCropMode(mode) {
    cropMode = mode;
    document.getElementById('btnStandardCrop').dataset.active = mode === 'standard';
    document.getElementById('btnPerspectiveCrop').dataset.active = mode === 'perspective';

    const subtitle = document.getElementById('cropModalSubtitle');
    if (mode === 'standard') {
        subtitle.textContent = "Drag handles to select the area you want to keep";
    } else {
        subtitle.textContent = "Drag the 4 corner handles to align with the card's skewed corners";
    }

    const canvas = document.getElementById('cropCanvas');
    const baseW = canvas.width / modalZoom;
    const baseH = canvas.height / modalZoom;

    if (mode === 'perspective' && perspectivePoints.length === 0) {
        // Initialize to 4 corners
        perspectivePoints = [
            { x: 30, y: 30 },
            { x: baseW - 30, y: 30 },
            { x: baseW - 30, y: baseH - 30 },
            { x: 30, y: baseH - 30 }
        ];
    }

    drawCropOverlay();
}

function detectCardBounds(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Downscale for fast pixel analysis
    const scale = Math.min(200 / img.naturalWidth, 200 / img.naturalHeight);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width;
    const h = canvas.height;
    
    // Sample corners to detect background color
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    const sampleCorner = (startX, startY) => {
        for (let y = startY; y < startY + 5; y++) {
            for (let x = startX; x < startX + 5; x++) {
                if (x >= 0 && x < w && y >= 0 && y < h) {
                    const idx = (y * w + x) * 4;
                    rSum += data[idx];
                    gSum += data[idx+1];
                    bSum += data[idx+2];
                    count++;
                }
            }
        }
    };
    sampleCorner(5, 5);
    sampleCorner(w - 10, 5);
    sampleCorner(5, h - 10);
    sampleCorner(w - 10, h - 10);
    
    const bgR = rSum / count;
    const bgG = gSum / count;
    const bgB = bSum / count;
    const bgGray = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
    const isLightBg = bgGray > 128;
    
    // Scan pixels to find bounding box of card (skip outer 4% to ignore scan border lines)
    const marginX = Math.round(w * 0.04);
    const marginY = Math.round(h * 0.04);
    
    let minX = w, maxX = 0, minY = h, maxY = 0;
    
    for (let y = marginY; y < h - marginY; y++) {
        for (let x = marginX; x < w - marginX; x++) {
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx+1];
            const b = data[idx+2];
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            
            const isForeground = isLightBg ? (gray < bgGray - 25) : (gray > bgGray + 25);
            
            if (isForeground) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    
    // If we detected a valid bounding box
    if (maxX > minX && maxY > minY) {
        const x = minX / scale;
        const y = minY / scale;
        const width = (maxX - minX) / scale;
        const height = (maxY - minY) / scale;
        
        // Add a small padding (15px) for safety
        const pad = 15;
        return {
            x: Math.max(0, x - pad),
            y: Math.max(0, y - pad),
            width: Math.min(img.naturalWidth - x, width + pad * 2),
            height: Math.min(img.naturalHeight - y, height + pad * 2)
        };
    }
    
    // Fallback: 80% center
    return {
        x: img.naturalWidth * 0.1,
        y: img.naturalHeight * 0.1,
        width: img.naturalWidth * 0.8,
        height: img.naturalHeight * 0.8
    };
}

function openCropModal() {
    const entry = AppState.scannedImages.find(img => img.id === AppState.selectedImageId);
    if (!entry) {
        showToast('Please select an image to crop', 'warning');
        return;
    }

    const modal = document.getElementById('cropModal');
    const canvas = document.getElementById('cropCanvas');
    const ctx = canvas.getContext('2d');

    modal.classList.add('active');

    // Load original image and size canvas to fit modal container
    const img = entry.originalImg;
    const maxW = 900;
    const maxH = 500;

    cropScale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    modalZoom = 1.0;
    document.getElementById('cropZoomLabel').textContent = '100%';

    canvas.width = img.naturalWidth * cropScale * modalZoom;
    canvas.height = img.naturalHeight * cropScale * modalZoom;

    // Draw initial image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Initialize crop mode
    if (entry.crop && entry.crop.type) {
        cropMode = entry.crop.type;
    } else {
        cropMode = 'standard';
    }
    document.getElementById('btnStandardCrop').dataset.active = cropMode === 'standard';
    document.getElementById('btnPerspectiveCrop').dataset.active = cropMode === 'perspective';

    const subtitle = document.getElementById('cropModalSubtitle');
    if (cropMode === 'standard') {
        subtitle.textContent = "Drag handles to select the area you want to keep";
        
        // Initialize crop box coords (base scale)
        if (entry.crop && entry.crop.type === 'standard') {
            cropBox.x1 = entry.crop.x * cropScale;
            cropBox.y1 = entry.crop.y * cropScale;
            cropBox.x2 = (entry.crop.x + entry.crop.width) * cropScale;
            cropBox.y2 = (entry.crop.y + entry.crop.height) * cropScale;
        } else {
            // Auto-detect card bounds!
            const bounds = detectCardBounds(img);
            cropBox.x1 = bounds.x * cropScale;
            cropBox.y1 = bounds.y * cropScale;
            cropBox.x2 = (bounds.x + bounds.width) * cropScale;
            cropBox.y2 = (bounds.y + bounds.height) * cropScale;
        }
        perspectivePoints = [];
    } else {
        subtitle.textContent = "Drag the 4 corner handles to align with the card's skewed corners";
        
        // Initialize perspective coords (base scale)
        if (entry.crop && entry.crop.type === 'perspective') {
            perspectivePoints = entry.crop.screenPoints.map(pt => ({
                x: pt.x * cropScale,
                y: pt.y * cropScale
            }));
        } else {
            // Auto-detect card bounds for perspective corners!
            const bounds = detectCardBounds(img);
            perspectivePoints = [
                { x: bounds.x * cropScale, y: bounds.y * cropScale },
                { x: (bounds.x + bounds.width) * cropScale, y: bounds.y * cropScale },
                { x: (bounds.x + bounds.width) * cropScale, y: (bounds.y + bounds.height) * cropScale },
                { x: bounds.x * cropScale, y: (bounds.y + bounds.height) * cropScale }
            ];
        }
    }

    drawCropOverlay();

    // Mouse drag listeners
    canvas.onmousedown = startCropDrag;
    canvas.onmousemove = moveCropDrag;
    window.onmouseup = endCropDrag;

    // Touch support for crop
    canvas.ontouchstart = (e) => {
        if (e.touches.length > 0) {
            startCropDrag({
                clientX: e.touches[0].clientX,
                clientY: e.touches[0].clientY,
                preventDefault: () => e.preventDefault(),
                target: canvas
            });
        }
    };
    canvas.ontouchmove = (e) => {
        if (e.touches.length > 0) {
            moveCropDrag({
                clientX: e.touches[0].clientX,
                clientY: e.touches[0].clientY,
                target: canvas
            });
        }
    };
}

function closeCropModal() {
    document.getElementById('cropModal').classList.remove('active');
    const canvas = document.getElementById('cropCanvas');
    canvas.onmousedown = null;
    canvas.onmousemove = null;
    window.onmouseup = null;
    canvas.ontouchstart = null;
    canvas.ontouchmove = null;
}

function drawCropOverlay() {
    const canvas = document.getElementById('cropCanvas');
    const ctx = canvas.getContext('2d');
    const entry = AppState.scannedImages.find(img => img.id === AppState.selectedImageId);
    if (!entry) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(entry.originalImg, 0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 2;

    const scale = modalZoom;

    if (cropMode === 'perspective') {
        // Map points to current zoom
        const pts = perspectivePoints.map(pt => ({
            x: pt.x * scale,
            y: pt.y * scale
        }));

        // Dark overlay outside quad
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.lineTo(pts[3].x, pts[3].y);
        ctx.closePath();
        ctx.rect(canvas.width, 0, -canvas.width, canvas.height);
        ctx.clip();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Draw quad borders
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.lineTo(pts[3].x, pts[3].y);
        ctx.closePath();
        ctx.stroke();

        // Draw handles on the 4 corners
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#14b8a6';
        ctx.lineWidth = 2;

        pts.forEach((pt, index) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            // Label corner
            ctx.fillStyle = '#2dd4bf';
            ctx.font = 'bold 9px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const labels = ['TL', 'TR', 'BR', 'BL'];
            ctx.fillText(labels[index], pt.x, pt.y - 12);
            ctx.fillStyle = '#ffffff';
        });
    } else {
        // Map coordinates to current zoom
        const x1 = Math.min(cropBox.x1, cropBox.x2) * scale;
        const y1 = Math.min(cropBox.y1, cropBox.y2) * scale;
        const x2 = Math.max(cropBox.x1, cropBox.x2) * scale;
        const y2 = Math.max(cropBox.y1, cropBox.y2) * scale;
        const w = x2 - x1;
        const h = y2 - y1;

        ctx.fillRect(0, 0, canvas.width, y1);
        ctx.fillRect(0, y2, canvas.width, canvas.height - y2);
        ctx.fillRect(0, y1, x1, y2 - y1);
        ctx.fillRect(x2, y1, canvas.width - x2, y2 - y1);

        ctx.strokeRect(x1, y1, w, h);

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#14b8a6';
        ctx.lineWidth = 2;

        const corners = [
            [x1, y1], // TL
            [x2, y1], // TR
            [x1, y2], // BL
            [x2, y2]  // BR
        ];

        corners.forEach(([cx, cy]) => {
            ctx.beginPath();
            ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        });
    }
}

function startCropDrag(e) {
    const canvas = document.getElementById('cropCanvas');
    const rect = canvas.getBoundingClientRect();
    
    // Convert click coordinates to base coordinates
    const clickX = (e.clientX - rect.left) / modalZoom;
    const clickY = (e.clientY - rect.top) / modalZoom;

    const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx)**2 + (ay - by)**2);
    const handleSize = 18 / modalZoom; // adjust sensitivity based on zoom

    if (cropMode === 'perspective') {
        activeHandle = null;
        for (let i = 0; i < 4; i++) {
            if (dist(clickX, clickY, perspectivePoints[i].x, perspectivePoints[i].y) < handleSize) {
                activeHandle = i;
                break;
            }
        }
        if (activeHandle === null) return;
    } else {
        const x1 = Math.min(cropBox.x1, cropBox.x2);
        const y1 = Math.min(cropBox.y1, cropBox.y2);
        const x2 = Math.max(cropBox.x1, cropBox.x2);
        const y2 = Math.max(cropBox.y1, cropBox.y2);

        if (dist(clickX, clickY, x1, y1) < handleSize) activeHandle = 'TL';
        else if (dist(clickX, clickY, x2, y1) < handleSize) activeHandle = 'TR';
        else if (dist(clickX, clickY, x1, y2) < handleSize) activeHandle = 'BL';
        else if (dist(clickX, clickY, x2, y2) < handleSize) activeHandle = 'BR';
        else if (clickX >= x1 && clickX <= x2 && clickY >= y1 && clickY <= y2) {
            activeHandle = 'MOVE';
            moveOffsetX = clickX - x1;
            moveOffsetY = clickY - y1;
            boxWidth = x2 - x1;
            boxHeight = y2 - y1;
        } else {
            activeHandle = 'NEW';
            cropBox.x1 = clickX;
            cropBox.y1 = clickY;
            cropBox.x2 = clickX;
            cropBox.y2 = clickY;
        }
    }

    isCropping = true;
    if (e.preventDefault) e.preventDefault();
}

function moveCropDrag(e) {
    if (!isCropping) return;
    const canvas = document.getElementById('cropCanvas');
    const rect = canvas.getBoundingClientRect();

    const baseW = canvas.width / modalZoom;
    const baseH = canvas.height / modalZoom;
    const clickX = Math.max(0, Math.min(baseW, (e.clientX - rect.left) / modalZoom));
    const clickY = Math.max(0, Math.min(baseH, (e.clientY - rect.top) / modalZoom));

    if (cropMode === 'perspective') {
        if (typeof activeHandle === 'number') {
            perspectivePoints[activeHandle].x = clickX;
            perspectivePoints[activeHandle].y = clickY;
        }
    } else {
        const x1 = Math.min(cropBox.x1, cropBox.x2);
        const y1 = Math.min(cropBox.y1, cropBox.y2);
        const x2 = Math.max(cropBox.x1, cropBox.x2);
        const y2 = Math.max(cropBox.y1, cropBox.y2);

        if (activeHandle === 'TL') {
            cropBox.x1 = Math.min(clickX, x2 - 10);
            cropBox.y1 = Math.min(clickY, y2 - 10);
        } else if (activeHandle === 'TR') {
            cropBox.x2 = Math.max(clickX, x1 + 10);
            cropBox.y1 = Math.min(clickY, y2 - 10);
        } else if (activeHandle === 'BL') {
            cropBox.x1 = Math.min(clickX, x2 - 10);
            cropBox.y2 = Math.max(clickY, y1 + 10);
        } else if (activeHandle === 'BR') {
            cropBox.x2 = Math.max(clickX, x1 + 10);
            cropBox.y2 = Math.max(clickY, y1 + 10);
        } else if (activeHandle === 'MOVE') {
            let newX1 = clickX - moveOffsetX;
            let newY1 = clickY - moveOffsetY;

            if (newX1 < 0) newX1 = 0;
            if (newY1 < 0) newY1 = 0;
            if (newX1 + boxWidth > baseW) newX1 = baseW - boxWidth;
            if (newY1 + boxHeight > baseH) newY1 = baseH - boxHeight;

            cropBox.x1 = newX1;
            cropBox.y1 = newY1;
            cropBox.x2 = newX1 + boxWidth;
            cropBox.y2 = newY1 + boxHeight;
        } else if (activeHandle === 'NEW') {
            cropBox.x2 = clickX;
            cropBox.y2 = clickY;
        }
    }

    drawCropOverlay();
}

function endCropDrag() {
    if (!isCropping) return;
    isCropping = false;
    activeHandle = null;

    if (cropMode === 'standard') {
        const x1 = Math.min(cropBox.x1, cropBox.x2);
        const y1 = Math.min(cropBox.y1, cropBox.y2);
        const x2 = Math.max(cropBox.x1, cropBox.x2);
        const y2 = Math.max(cropBox.y1, cropBox.y2);

        cropBox.x1 = x1;
        cropBox.y1 = y1;
        cropBox.x2 = x2;
        cropBox.y2 = y2;
    }

    drawCropOverlay();
}

function applyCrop() {
    const entry = AppState.scannedImages.find(img => img.id === AppState.selectedImageId);
    if (!entry) return;

    if (cropMode === 'perspective') {
        const pts = perspectivePoints.map(pt => ({
            x: pt.x / cropScale,
            y: pt.y / cropScale
        }));

        const dist = (p1, p2) => Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
        const topW = dist(pts[0], pts[1]);
        const bottomW = dist(pts[3], pts[2]);
        const leftH = dist(pts[0], pts[3]);
        const rightH = dist(pts[1], pts[2]);

        const dstWidth = Math.round(Math.max(topW, bottomW));
        const dstHeight = Math.round(Math.max(leftH, rightH));

        if (dstWidth < 10 || dstHeight < 10) {
            showToast('Please select a larger crop area', 'warning');
            return;
        }

        entry.crop = {
            type: 'perspective',
            points: pts,
            screenPoints: perspectivePoints.map(pt => ({ x: pt.x, y: pt.y })), // save in base coords
            width: dstWidth,
            height: dstHeight
        };
    } else {
        const x = Math.min(cropBox.x1, cropBox.x2);
        const y = Math.min(cropBox.y1, cropBox.y2);
        const w = Math.abs(cropBox.x1 - cropBox.x2);
        const h = Math.abs(cropBox.y1 - cropBox.y2);

        if (w < 10 || h < 10) {
            showToast('Please select a larger crop area', 'warning');
            return;
        }

        entry.crop = {
            type: 'standard',
            x: Math.round(x / cropScale),
            y: Math.round(y / cropScale),
            width: Math.round(w / cropScale),
            height: Math.round(h / cropScale)
        };
    }

    entry.processedCanvas = processImage(entry);

    syncPlacementsWithImages();

    renderScannedImagesList();
    renderPagePreview();
    closeCropModal();
    showToast('Image cropped successfully!', 'success');
}
