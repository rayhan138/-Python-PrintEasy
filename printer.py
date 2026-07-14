"""
PrintEasy Printer Module
Handles direct printing to Windows printers with B&W support.
Uses win32print and Pillow for image composition and printing.
"""

import logging
import base64
import tempfile
import os
from io import BytesIO

logger = logging.getLogger(__name__)


def list_printers():
    """
    List all available Windows printers.
    
    Returns:
        list: List of dicts with 'name' and 'is_default' keys.
    """
    try:
        import win32print
        
        printers = []
        default_printer = win32print.GetDefaultPrinter()
        
        # Enumerate printers (level 2 gives detailed info)
        printer_list = win32print.EnumPrinters(
            win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS,
            None, 1
        )
        
        for flags, description, name, comment in printer_list:
            printers.append({
                'name': name,
                'is_default': (name == default_printer)
            })
        
        return printers
    
    except Exception as e:
        logger.error(f"Error listing printers: {e}")
        return []


def print_image(image_data_b64, printer_name=None, copies=1, paper_size='A5', print_mode='mono'):
    """
    Print a composed page image directly to a Windows printer.
    
    Args:
        image_data_b64: Base64 encoded image data (the full composed page).
                        Can include or exclude the 'data:image/png;base64,' prefix.
        printer_name: Name of the printer. If None, uses default printer.
        copies: Number of copies to print.
        paper_size: Paper size string ('A4', 'A5', 'Letter', etc.)
    
    Returns:
        dict: {'success': bool, 'message': str}
    """
    import win32print
    import win32ui
    import win32con
    import win32gui
    from PIL import Image, ImageWin
    
    # Decode the base64 image
    if ',' in image_data_b64:
        image_data_b64 = image_data_b64.split(',')[1]
    
    image_bytes = base64.b64decode(image_data_b64)
    img = Image.open(BytesIO(image_bytes))
    
    # Ensure image is in a printable mode
    if img.mode == 'RGBA':
        # Create white background for transparency
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
    elif img.mode == 'L':
        img = img.convert('RGB')
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Get printer name
    if not printer_name:
        printer_name = win32print.GetDefaultPrinter()
    
    logger.info(f"Printing to '{printer_name}', copies={copies}, paper={paper_size}")
    
    devmode = None
    try:
        hprinter = win32print.OpenPrinter(printer_name)
        try:
            info = win32print.GetPrinter(hprinter, 2)
            devmode = info['pDevMode']
            
            # Map paper size to Windows printer DEVMODE constants
            paper_mapping = {
                'A3': win32con.DMPAPER_A3,
                'A4': win32con.DMPAPER_A4,
                'A5': win32con.DMPAPER_A5,
                'A6': win32con.DMPAPER_A6,
                'Letter': win32con.DMPAPER_LETTER,
                'Legal': win32con.DMPAPER_LEGAL,
                'B5': win32con.DMPAPER_B5,
            }
            devmode.PaperSize = paper_mapping.get(paper_size, win32con.DMPAPER_A5)
            
            # Set orientation dynamically based on image aspect ratio
            if img.width > img.height:
                devmode.Orientation = win32con.DMORIENT_LANDSCAPE
            else:
                devmode.Orientation = win32con.DMORIENT_PORTRAIT
            
            # Force Monochrome or Color based on print_mode
            if print_mode == 'mono':
                devmode.Color = win32con.DMCOLOR_MONOCHROME
            elif print_mode == 'color':
                devmode.Color = win32con.DMCOLOR_COLOR
        finally:
            win32print.ClosePrinter(hprinter)
    except Exception as e:
        logger.warning(f"Could not configure DEVMODE for printer: {e}. Printing with defaults.")

    try:
        for copy_num in range(copies):
            # Create a device context for the printer using our custom DEVMODE
            if devmode:
                hdc_handle = win32gui.CreateDC("WINSPOOL", printer_name, devmode)
                hdc = win32ui.CreateDCFromHandle(hdc_handle)
            else:
                hdc = win32ui.CreateDC()
                hdc.CreatePrinterDC(printer_name)
            
            # Get printer capabilities
            printable_width = hdc.GetDeviceCaps(win32con.HORZRES)   # Printable width in pixels
            printable_height = hdc.GetDeviceCaps(win32con.VERTRES)  # Printable height in pixels
            printer_dpi_x = hdc.GetDeviceCaps(win32con.LOGPIXELSX)  # Printer DPI horizontal
            printer_dpi_y = hdc.GetDeviceCaps(win32con.LOGPIXELSY)  # Printer DPI vertical
            
            logger.info(
                f"Printer: {printable_width}x{printable_height} pixels, "
                f"{printer_dpi_x}x{printer_dpi_y} DPI"
            )
            
            # Calculate scaling to fit the image on the page
            # while maintaining aspect ratio
            img_width, img_height = img.size
            
            scale_x = printable_width / img_width
            scale_y = printable_height / img_height
            scale = min(scale_x, scale_y)
            
            # Center the image on the page
            dest_width = int(img_width * scale)
            dest_height = int(img_height * scale)
            dest_x = (printable_width - dest_width) // 2
            dest_y = (printable_height - dest_height) // 2
            
            # Start the print job
            hdc.StartDoc(f'PrintEasy - Copy {copy_num + 1}')
            hdc.StartPage()
            
            # Create a DIB (Device Independent Bitmap) from the image
            dib = ImageWin.Dib(img)
            
            # Draw the image onto the printer DC
            dib.draw(
                hdc.GetHandleOutput(),
                (dest_x, dest_y, dest_x + dest_width, dest_y + dest_height)
            )
            
            # End the print job
            hdc.EndPage()
            hdc.EndDoc()
            hdc.DeleteDC()
        
        return {
            'success': True,
            'message': f'Printed {copies} {"copy" if copies == 1 else "copies"} to {printer_name}'
        }
    
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Print error: {error_msg}")
        return {
            'success': False,
            'message': f'Print failed: {error_msg}'
        }


def get_paper_dimensions_mm(paper_size):
    """
    Get paper dimensions in millimeters.
    
    Args:
        paper_size: Paper size string ('A4', 'A5', 'Letter', etc.)
    
    Returns:
        tuple: (width_mm, height_mm) in portrait orientation.
    """
    sizes = {
        'A3': (297, 420),
        'A4': (210, 297),
        'A5': (148, 210),
        'A6': (105, 148),
        'Letter': (216, 279),
        'Legal': (216, 356),
        'B5': (176, 250),
    }
    return sizes.get(paper_size, sizes['A5'])
