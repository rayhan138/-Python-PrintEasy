/**
 * PrintEasy — Layout Templates Module
 * Defines pre-built templates for arranging ID card scans on a page.
 * All measurements are in millimeters relative to the page.
 */

const Templates = {

    /**
     * Paper size definitions in mm (portrait orientation).
     */
    paperSizes: {
        'A3': { width: 297, height: 420 },
        'A4': { width: 210, height: 297 },
        'A5': { width: 148, height: 210 },
        'A6': { width: 105, height: 148 },
        'Letter': { width: 216, height: 279 },
        'Legal': { width: 216, height: 356 },
    },

    /**
     * Standard ID card dimensions (ISO/IEC 7810 ID-1, same as credit card).
     * 85.6mm × 53.98mm
     */
    idCard: {
        width: 85.6,
        height: 54
    },

    /**
     * Margin from page edges in mm.
     */
    margin: 8,

    /**
     * Get the zones (placement areas) for a given template on a given paper size.
     * 
     * @param {string} templateId - Template identifier
     * @param {string} paperSize - Paper size key (e.g., 'A5')
     * @param {string} orientation - 'portrait' or 'landscape'
     * @returns {Object} { zones: [{label, x, y, width, height}], description }
     */
    getTemplate(templateId, paperSize = 'A5', orientation = 'portrait') {
        const paper = this.paperSizes[paperSize] || this.paperSizes['A5'];
        
        // Apply orientation
        let pageW, pageH;
        if (orientation === 'landscape') {
            pageW = Math.max(paper.width, paper.height);
            pageH = Math.min(paper.width, paper.height);
        } else {
            pageW = Math.min(paper.width, paper.height);
            pageH = Math.max(paper.width, paper.height);
        }

        const margin = this.margin;
        const contentW = pageW - margin * 2;
        const contentH = pageH - margin * 2;

        const id = this.idCard;

        switch (templateId) {
            case 'front-back':
                return this._frontBackTemplate(pageW, pageH, contentW, contentH, margin, id);
            case '2x-front-back':
                return this._2xFrontBackTemplate(pageW, pageH, contentW, contentH, margin, id);
            case 'single':
                return this._singleTemplate(pageW, pageH, contentW, contentH, margin, id);
            case 'two-copies':
                return this._twoCopiesTemplate(pageW, pageH, contentW, contentH, margin, id);
            case 'four-copies':
                return this._fourCopiesTemplate(pageW, pageH, contentW, contentH, margin, id);
            case 'full-page':
                return this._fullPageTemplate(pageW, pageH, contentW, contentH, margin);
            case 'custom':
                return this._customTemplate(pageW, pageH, contentW, contentH, margin);
            default:
                return this._2xFrontBackTemplate(pageW, pageH, contentW, contentH, margin, id);
        }
    },

    /**
     * ID Card — Front & Back on one page.
     * Front side on the top half, back side on the bottom half.
     */
    _frontBackTemplate(pageW, pageH, contentW, contentH, margin, id) {
        // Scale ID card to fit content width while maintaining aspect ratio
        const scale = Math.min(contentW / id.width, (contentH / 2 - 4) / id.height);
        const cardW = id.width * scale;
        const cardH = id.height * scale;

        // Center horizontally
        const cardX = (pageW - cardW) / 2;

        // Position: top half and bottom half with a gap
        const gap = 6;
        const topY = (pageH / 2 - gap / 2 - cardH) / 2 + margin / 2;
        const bottomY = pageH / 2 + gap / 2 + (pageH / 2 - gap / 2 - cardH) / 2 - margin / 2;

        return {
            description: 'Front & Back — both sides on one page',
            requiredImages: 2,
            zones: [
                {
                    label: 'Front Side',
                    x: cardX,
                    y: topY,
                    width: cardW,
                    height: cardH,
                    imageIndex: 0
                },
                {
                    label: 'Back Side',
                    x: cardX,
                    y: bottomY,
                    width: cardW,
                    height: cardH,
                    imageIndex: 1
                }
            ]
        };
    },

    /**
     * 2× ID Card — Front & Back on EACH half of A4 landscape.
     * Splits the page into two A5 halves with a center divider.
     * Left half: Front (top) + Back (bottom)
     * Right half: Front (top) + Back (bottom)
     */
    _2xFrontBackTemplate(pageW, pageH, contentW, contentH, margin, id) {
        const halfW = pageW / 2;
        const halfContentW = halfW - margin * 2;
        const halfContentH = pageH - margin * 2;

        // Scale ID card to fit half-page width, then shrink to 70% for realistic ID card size
        const scale = Math.min(halfContentW / id.width, (halfContentH / 2 - 4) / id.height) * 0.70;
        const cardW = id.width * scale;
        const cardH = id.height * scale;

        const gap = 3;

        // Position both cards close together, centered as a group on the page
        const totalH = cardH * 2 + gap;
        const startY = (pageH - totalH) / 2;
        const topY = startY;
        const bottomY = startY + cardH + gap;

        // Left half — centered horizontally within left A5
        const leftCardX = (halfW - cardW) / 2;

        // Right half — centered horizontally within right A5
        const rightCardX = halfW + (halfW - cardW) / 2;

        return {
            description: '2× Front & Back — two ID copies on one page',
            requiredImages: 2,
            showCenterLine: true,
            zones: [
                { label: 'Front Side', x: leftCardX, y: topY, width: cardW, height: cardH, imageIndex: 0 },
                { label: 'Back Side', x: leftCardX, y: bottomY, width: cardW, height: cardH, imageIndex: 1 },
                { label: 'Front Side', x: rightCardX, y: topY, width: cardW, height: cardH, imageIndex: 0 },
                { label: 'Back Side', x: rightCardX, y: bottomY, width: cardW, height: cardH, imageIndex: 1 },
            ]
        };
    },

    /**
     * ID Card — Single side centered on page.
     */
    _singleTemplate(pageW, pageH, contentW, contentH, margin, id) {
        const scale = Math.min(contentW / id.width, contentH / id.height);
        const cardW = id.width * scale;
        const cardH = id.height * scale;
        const cardX = (pageW - cardW) / 2;
        const cardY = (pageH - cardH) / 2;

        return {
            description: 'Single Side — one side centered on page',
            requiredImages: 1,
            zones: [
                {
                    label: 'ID Card',
                    x: cardX,
                    y: cardY,
                    width: cardW,
                    height: cardH,
                    imageIndex: 0
                }
            ]
        };
    },

    /**
     * ID Card — 2 copies of the same side.
     */
    _twoCopiesTemplate(pageW, pageH, contentW, contentH, margin, id) {
        const scale = Math.min(contentW / id.width, (contentH / 2 - 4) / id.height);
        const cardW = id.width * scale;
        const cardH = id.height * scale;
        const cardX = (pageW - cardW) / 2;

        const gap = 6;
        const topY = (pageH / 2 - gap / 2 - cardH) / 2 + margin / 2;
        const bottomY = pageH / 2 + gap / 2 + (pageH / 2 - gap / 2 - cardH) / 2 - margin / 2;

        return {
            description: '2 Copies — same image twice',
            requiredImages: 1,
            zones: [
                {
                    label: 'Copy 1',
                    x: cardX,
                    y: topY,
                    width: cardW,
                    height: cardH,
                    imageIndex: 0
                },
                {
                    label: 'Copy 2',
                    x: cardX,
                    y: bottomY,
                    width: cardW,
                    height: cardH,
                    imageIndex: 0
                }
            ]
        };
    },

    /**
     * ID Card — 4 copies in a 2x2 grid.
     */
    _fourCopiesTemplate(pageW, pageH, contentW, contentH, margin, id) {
        const gap = 4;
        const cellW = (contentW - gap) / 2;
        const cellH = (contentH - gap) / 2;

        const scale = Math.min(cellW / id.width, cellH / id.height);
        const cardW = id.width * scale;
        const cardH = id.height * scale;

        const zones = [];
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                const cellX = margin + col * (cellW + gap);
                const cellY = margin + row * (cellH + gap);
                // Center card within cell
                const cardX = cellX + (cellW - cardW) / 2;
                const cardY = cellY + (cellH - cardH) / 2;

                zones.push({
                    label: `Copy ${row * 2 + col + 1}`,
                    x: cardX,
                    y: cardY,
                    width: cardW,
                    height: cardH,
                    imageIndex: 0
                });
            }
        }

        return {
            description: '4 Copies — 2×2 grid',
            requiredImages: 1,
            zones
        };
    },

    /**
     * Full Page — Scale image to fill entire page.
     */
    _fullPageTemplate(pageW, pageH, contentW, contentH, margin) {
        return {
            description: 'Full Page — image fills the entire page',
            requiredImages: 1,
            zones: [
                {
                    label: 'Full Page',
                    x: margin,
                    y: margin,
                    width: contentW,
                    height: contentH,
                    imageIndex: 0
                }
            ]
        };
    },

    /**
     * Custom — Free positioning (starts with a centered area).
     */
    _customTemplate(pageW, pageH, contentW, contentH, margin) {
        const cardW = contentW * 0.6;
        const cardH = cardW * (54 / 85.6); // ID card ratio
        
        return {
            description: 'Custom — free position and size',
            requiredImages: 1,
            zones: [
                {
                    label: 'Image',
                    x: (pageW - cardW) / 2,
                    y: (pageH - cardH) / 2,
                    width: cardW,
                    height: cardH,
                    imageIndex: 0
                }
            ]
        };
    },

    /**
     * Get page dimensions considering orientation.
     */
    getPageDimensions(paperSize, orientation) {
        const paper = this.paperSizes[paperSize] || this.paperSizes['A5'];
        if (orientation === 'landscape') {
            return {
                width: Math.max(paper.width, paper.height),
                height: Math.min(paper.width, paper.height)
            };
        }
        return {
            width: Math.min(paper.width, paper.height),
            height: Math.max(paper.width, paper.height)
        };
    }
};
