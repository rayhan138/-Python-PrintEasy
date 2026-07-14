/**
 * PrintEasy — Image Processor Module
 * Handles B&W conversion, brightness, contrast, rotation, and composition.
 */

const ImageProcessor = {
    /**
     * Convert an image to grayscale using Canvas pixel manipulation.
     * @param {HTMLImageElement|HTMLCanvasElement} source - Source image
     * @param {Object} options - Processing options
     * @param {number} options.brightness - Brightness adjustment (-100 to 100)
     * @param {number} options.contrast - Contrast adjustment (-100 to 100)
     * @param {number} options.threshold - B&W threshold (0=off, 1-255=threshold value)
     * @returns {HTMLCanvasElement} Processed canvas
     */
    processToGrayscale(source, options = {}) {
        const {
            brightness = 0,
            contrast = 0,
            threshold = 0
        } = options;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Get source dimensions
        const sw = source.naturalWidth || source.width;
        const sh = source.naturalHeight || source.height;
        canvas.width = sw;
        canvas.height = sh;

        // Draw source image
        ctx.drawImage(source, 0, 0, sw, sh);

        // Get pixel data
        const imageData = ctx.getImageData(0, 0, sw, sh);
        const data = imageData.data;

        // Pre-compute contrast factor
        const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        // Pre-compute brightness offset (map -100..100 to -255..255)
        const brightnessOffset = (brightness / 100) * 255;

        for (let i = 0; i < data.length; i += 4) {
            // Convert to luminance-weighted grayscale
            let gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];

            // Apply brightness
            gray += brightnessOffset;

            // Apply contrast
            gray = contrastFactor * (gray - 128) + 128;

            // Clamp
            gray = Math.max(0, Math.min(255, gray));

            // Apply threshold for pure B&W if enabled
            if (threshold > 0) {
                gray = gray > threshold ? 255 : 0;
            }

            data[i] = gray;     // R
            data[i + 1] = gray; // G
            data[i + 2] = gray; // B
            // Alpha unchanged
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    },

    /**
     * Rotate an image by a given angle.
     * @param {HTMLImageElement|HTMLCanvasElement} source - Source image
     * @param {number} angleDeg - Rotation angle in degrees (90, 180, 270, -90)
     * @returns {HTMLCanvasElement} Rotated canvas
     */
    rotate(source, angleDeg) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const sw = source.naturalWidth || source.width;
        const sh = source.naturalHeight || source.height;

        // Normalize angle
        angleDeg = ((angleDeg % 360) + 360) % 360;

        if (angleDeg === 90 || angleDeg === 270) {
            canvas.width = sh;
            canvas.height = sw;
        } else {
            canvas.width = sw;
            canvas.height = sh;
        }

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((angleDeg * Math.PI) / 180);
        ctx.drawImage(source, -sw / 2, -sh / 2);

        return canvas;
    },

    /**
     * Load an image from a data URI or URL.
     * @param {string} src - Image source (data URI or URL)
     * @returns {Promise<HTMLImageElement>} Loaded image element
     */
    loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(new Error('Failed to load image'));
            img.src = src;
        });
    },

    /**
     * Compose a final print page with images placed according to template zones.
     * @param {Object} config - Composition configuration
     * @param {number} config.pageWidthMM - Page width in mm
     * @param {number} config.pageHeightMM - Page height in mm
     * @param {number} config.dpi - Output DPI (default 300)
     * @param {Array} config.placements - Array of {image, x, y, width, height} in mm
     * @returns {HTMLCanvasElement} Final composed page
     */
    composePage(config) {
        const {
            pageWidthMM,
            pageHeightMM,
            dpi = 300,
            placements = []
        } = config;

        // Convert mm to pixels at the given DPI
        const mmToPx = (mm) => Math.round((mm / 25.4) * dpi);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = mmToPx(pageWidthMM);
        canvas.height = mmToPx(pageHeightMM);

        // Fill white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw each placement
        for (const placement of placements) {
            if (!placement.image) continue;

            const dx = mmToPx(placement.x);
            const dy = mmToPx(placement.y);
            const dw = mmToPx(placement.width);
            const dh = mmToPx(placement.height);

            ctx.drawImage(placement.image, dx, dy, dw, dh);
        }

        return canvas;
    },

    /**
     * Convert a canvas to a base64 data URI.
     * @param {HTMLCanvasElement} canvas
     * @param {string} format - 'image/png' or 'image/jpeg'
     * @param {number} quality - JPEG quality (0-1)
     * @returns {string} Data URI
     */
    canvasToDataURI(canvas, format = 'image/png', quality = 0.95) {
        return canvas.toDataURL(format, quality);
    },

    /**
     * Trigger download of a canvas as an image file.
     * @param {HTMLCanvasElement} canvas
     * @param {string} filename
     */
    downloadCanvas(canvas, filename = 'printeasy-output.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
};
