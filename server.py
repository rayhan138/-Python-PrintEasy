"""
PrintEasy Server
Flask web server that provides API endpoints for scanning, printing,
and serves the web frontend.
"""

import os
import sys
import logging
import base64
import threading
import webbrowser
from io import BytesIO
from flask import Flask, render_template, request, jsonify, send_from_directory

import scanner
import printer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)


def get_base_path():
    """Get the base path for bundled resources (PyInstaller compatibility)."""
    if getattr(sys, 'frozen', False):
        # Running as a PyInstaller bundle
        return sys._MEIPASS
    else:
        # Running as a normal script
        return os.path.dirname(os.path.abspath(__file__))


base_path = get_base_path()

# Create Flask app with correct paths for both dev and bundled mode
app = Flask(__name__,
    static_folder=os.path.join(base_path, 'static'),
    template_folder=os.path.join(base_path, 'templates')
)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max upload


# ─── Page Routes ────────────────────────────────────────────

@app.route('/')
def index():
    """Serve the main application page."""
    return render_template('index.html')


# ─── Scanner API ────────────────────────────────────────────

@app.route('/api/scanners', methods=['GET'])
def api_list_scanners():
    """List all available WIA scanners."""
    try:
        scanners = scanner.list_scanners()
        return jsonify({
            'success': True,
            'scanners': scanners
        })
    except Exception as e:
        logger.error(f"Error listing scanners: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'scanners': []
        })


@app.route('/api/scan', methods=['POST'])
def api_scan():
    """
    Scan a document from the selected scanner.
    
    Request JSON:
        scanner_id (str, optional): Scanner device ID. Uses first available if omitted.
        dpi (int, optional): Scan resolution. Default 300.
        grayscale (bool, optional): Scan in grayscale. Default True.
    
    Response JSON:
        success (bool): Whether the scan was successful.
        image (str): Base64 data URI of the scanned image.
        width (int): Image width in pixels.
        height (int): Image height in pixels.
    """
    try:
        data = request.get_json() or {}
        scanner_id = data.get('scanner_id', None)
        dpi = data.get('dpi', 300)
        grayscale = data.get('grayscale', True)
        
        # Validate DPI
        dpi = max(75, min(1200, int(dpi)))
        
        logger.info(f"Scan request: scanner={scanner_id}, dpi={dpi}, grayscale={grayscale}")
        
        result = scanner.scan(
            scanner_id=scanner_id,
            dpi=dpi,
            grayscale=grayscale
        )
        
        return jsonify({
            'success': True,
            'image': result['image'],
            'width': result['width'],
            'height': result['height']
        })
    
    except RuntimeError as e:
        logger.error(f"Scan error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400
    
    except Exception as e:
        logger.error(f"Unexpected scan error: {e}")
        return jsonify({
            'success': False,
            'error': f"Unexpected error: {str(e)}"
        }), 500


# ─── Printer API ────────────────────────────────────────────

@app.route('/api/printers', methods=['GET'])
def api_list_printers():
    """List all available Windows printers."""
    try:
        printers = printer.list_printers()
        return jsonify({
            'success': True,
            'printers': printers
        })
    except Exception as e:
        logger.error(f"Error listing printers: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'printers': []
        })


@app.route('/api/print', methods=['POST'])
def api_print():
    """
    Print a composed page image.
    
    Request JSON:
        image_data (str): Base64 encoded image of the full composed page.
        printer_name (str, optional): Printer name. Uses default if omitted.
        copies (int, optional): Number of copies. Default 1.
        paper_size (str, optional): Paper size. Default 'A5'.
    
    Response JSON:
        success (bool): Whether printing was successful.
        message (str): Status message.
    """
    try:
        data = request.get_json() or {}
        image_data = data.get('image_data', '')
        printer_name = data.get('printer_name', None)
        copies = data.get('copies', 1)
        paper_size = data.get('paper_size', 'A5')
        print_mode = data.get('print_mode', 'mono')
        
        if not image_data:
            return jsonify({
                'success': False,
                'error': 'No image data provided'
            }), 400
        
        # Validate copies
        copies = max(1, min(99, int(copies)))
        
        logger.info(f"Print request: printer={printer_name}, copies={copies}, paper={paper_size}, mode={print_mode}")
        
        result = printer.print_image(
            image_data_b64=image_data,
            printer_name=printer_name,
            copies=copies,
            paper_size=paper_size,
            print_mode=print_mode
        )
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"Print error: {e}")
        return jsonify({
            'success': False,
            'message': f"Print error: {str(e)}"
        }), 500


# ─── Upload API ─────────────────────────────────────────────

@app.route('/api/upload', methods=['POST'])
def api_upload():
    """
    Upload an image file (for cases where the user already has a scanned file).
    
    Accepts multipart/form-data with a 'file' field.
    
    Response JSON:
        success (bool): Whether the upload was successful.
        image (str): Base64 data URI of the uploaded image.
        width (int): Image width in pixels.
        height (int): Image height in pixels.
    """
    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file uploaded'
            }), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400
        
        # Read and process the image
        from PIL import Image
        
        img = Image.open(file.stream)
        
        # Convert to RGB if needed
        if img.mode == 'RGBA':
            bg = Image.new('RGB', img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        
        width, height = img.size
        
        # Convert to base64 PNG
        buffer = BytesIO()
        img.save(buffer, format='PNG', optimize=True)
        buffer.seek(0)
        image_b64 = base64.b64encode(buffer.read()).decode('utf-8')
        
        return jsonify({
            'success': True,
            'image': f"data:image/png;base64,{image_b64}",
            'width': width,
            'height': height
        })
    
    except Exception as e:
        logger.error(f"Upload error: {e}")
        return jsonify({
            'success': False,
            'error': f"Upload error: {str(e)}"
        }), 500


# ─── Paper Size Info API ────────────────────────────────────

@app.route('/api/paper-sizes', methods=['GET'])
def api_paper_sizes():
    """Get available paper sizes and their dimensions."""
    sizes = {
        'A3': {'width': 297, 'height': 420},
        'A4': {'width': 210, 'height': 297},
        'A5': {'width': 148, 'height': 210},
        'A6': {'width': 105, 'height': 148},
        'Letter': {'width': 216, 'height': 279},
        'Legal': {'width': 216, 'height': 356},
    }
    return jsonify({
        'success': True,
        'sizes': sizes,
        'default': 'A5'
    })


# ─── Main ───────────────────────────────────────────────────

def open_browser():
    """Open the default browser after a short delay."""
    webbrowser.open('http://localhost:5000')


if __name__ == '__main__':
    print()
    print("  +======================================+")
    print("  |        PrintEasy v1.0                |")
    print("  |   Scan - Arrange - Print in B&W      |")
    print("  +--------------------------------------+")
    print("  |   Open: http://localhost:5000         |")
    print("  |   Press Ctrl+C to stop               |")
    print("  +======================================+")
    print()
    
    # Auto-open browser after 1.5 seconds
    threading.Timer(1.5, open_browser).start()
    
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=False
    )
