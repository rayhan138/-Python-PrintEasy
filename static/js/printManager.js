/**
 * PrintEasy — Print Manager Module
 * Handles sending print jobs to the server and browser print fallback.
 */

const PrintManager = {

    /**
     * Send a print job to the Flask server for direct printing.
     * @param {HTMLCanvasElement} canvas - The composed page canvas
     * @param {Object} options - Print options
     * @param {string} options.printerName - Selected printer name
     * @param {number} options.copies - Number of copies
     * @param {string} options.paperSize - Paper size
     * @returns {Promise<Object>} Server response
     */
    async printDirect(canvas, options = {}) {
        const {
            printerName = null,
            copies = 1,
            paperSize = 'A5',
            printMode = 'mono'
        } = options;

        const imageData = canvas.toDataURL('image/png');

        const response = await fetch('/api/print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_data: imageData,
                printer_name: printerName,
                copies: copies,
                paper_size: paperSize,
                print_mode: printMode
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || errorData.error || `Print failed (HTTP ${response.status})`);
        }

        return await response.json();
    },

    /**
     * Fallback: Print using browser's print dialog.
     * Opens a new window with just the canvas image and triggers print.
     * @param {HTMLCanvasElement} canvas - The composed page canvas
     * @param {string} paperSize - Paper size for @page CSS
     */
    printViaBrowser(canvas, paperSize = 'A5') {
        const dataUrl = canvas.toDataURL('image/png');
        
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            throw new Error('Could not open print window. Please allow popups.');
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>PrintEasy - Print</title>
                <style>
                    @page {
                        size: ${paperSize} portrait;
                        margin: 0;
                    }
                    * { margin: 0; padding: 0; }
                    body {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                    }
                    img {
                        max-width: 100%;
                        max-height: 100vh;
                        object-fit: contain;
                    }
                </style>
            </head>
            <body>
                <img src="${dataUrl}" onload="setTimeout(()=>{window.print();window.close();},300)">
            </body>
            </html>
        `);
        printWindow.document.close();
    },

    /**
     * Save the composed page as a downloadable image.
     * @param {HTMLCanvasElement} canvas - The composed page canvas
     * @param {string} filename - Download filename
     */
    saveAsImage(canvas, filename = 'printeasy-output.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    /**
     * Fetch available printers from the server.
     * @returns {Promise<Array>} List of printer objects {name, is_default}
     */
    async fetchPrinters() {
        const response = await fetch('/api/printers');
        const data = await response.json();
        if (data.success) {
            return data.printers;
        }
        throw new Error(data.error || 'Failed to fetch printers');
    }
};
