"""
PrintEasy Scanner Module
Interfaces with Windows WIA (Windows Image Acquisition) to scan documents
from connected scanners like the Brother T430W.
"""

import os
import tempfile
import base64
import logging
import pythoncom
import uuid
from io import BytesIO

logger = logging.getLogger(__name__)

# WIA Constants
WIA_DEVICE_TYPE_SCANNER = 1
WIA_IMG_FORMAT_PNG = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}"
WIA_IMG_FORMAT_BMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}"

# WIA Item Property IDs
WIA_IPA_DATATYPE = 4103       # Data type (color mode)
WIA_IPS_CUR_INTENT = 6146    # Current scanning intent
WIA_IPS_XRES = 6147          # Horizontal resolution (DPI)
WIA_IPS_YRES = 6148          # Vertical resolution (DPI)
WIA_IPS_XPOS = 6149          # Horizontal start position
WIA_IPS_YPOS = 6150          # Vertical start position
WIA_IPS_XEXTENT = 6151       # Width in pixels
WIA_IPS_YEXTENT = 6152       # Height in pixels
WIA_IPS_BRIGHTNESS = 6154    # Brightness
WIA_IPS_CONTRAST = 6155      # Contrast

# Data type values
WIA_DATA_COLOR = 0
WIA_DATA_GRAYSCALE = 2
WIA_DATA_BW = 4

# Intent values
WIA_INTENT_COLOR = 1
WIA_INTENT_GRAYSCALE = 2
WIA_INTENT_TEXT = 4


def _get_wia_manager():
    """Create and return a WIA DeviceManager COM object."""
    try:
        import win32com.client
        # Initialize COM for this thread (required in Flask worker threads)
        pythoncom.CoInitialize()
        return win32com.client.Dispatch("WIA.DeviceManager")
    except Exception as e:
        logger.error(f"Failed to create WIA DeviceManager: {e}")
        raise RuntimeError(
            "Could not initialize WIA. Make sure Windows Image Acquisition service is running."
        ) from e


def list_scanners():
    """
    List all available WIA scanners.
    
    Returns:
        list: List of dicts with 'id' and 'name' keys.
    """
    scanners = []
    try:
        manager = _get_wia_manager()
        for i in range(1, manager.DeviceInfos.Count + 1):
            device_info = manager.DeviceInfos.Item(i)
            if device_info.Type == WIA_DEVICE_TYPE_SCANNER:
                # Extract device properties
                name = ""
                device_id = ""
                try:
                    for j in range(1, device_info.Properties.Count + 1):
                        prop = device_info.Properties.Item(j)
                        if prop.Name == "Name":
                            name = prop.Value
                        elif prop.Name == "Unique Device ID":
                            device_id = prop.Value
                except Exception:
                    name = f"Scanner {i}"
                    device_id = str(i)
                
                scanners.append({
                    'id': device_id,
                    'name': name or f"Scanner {i}"
                })
    except Exception as e:
        logger.error(f"Error listing scanners: {e}")
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass
    
    return scanners


def _set_wia_property(properties, prop_id, value):
    """Set a WIA property by its ID."""
    try:
        for i in range(1, properties.Count + 1):
            prop = properties.Item(i)
            if prop.PropertyID == prop_id:
                prop.Value = value
                return True
    except Exception as e:
        logger.warning(f"Could not set WIA property {prop_id} to {value}: {e}")
    return False


def _get_wia_property(properties, prop_id):
    """Get a WIA property value by its ID."""
    try:
        for i in range(1, properties.Count + 1):
            prop = properties.Item(i)
            if prop.PropertyID == prop_id:
                return prop.Value
    except Exception:
        pass
    return None


def scan(scanner_id=None, dpi=300, grayscale=True):
    """
    Scan an image from the specified scanner.
    
    Args:
        scanner_id: WIA device ID. If None, uses the first available scanner.
        dpi: Scan resolution (150, 300, 600).
        grayscale: If True, scan in grayscale. If False, scan in color.
    
    Returns:
        dict: {
            'image': base64 encoded PNG image string,
            'width': image width in pixels,
            'height': image height in pixels
        }
    """
    import win32com.client
    
    temp_filename = f"printeasy_scan_temp_{uuid.uuid4().hex}.bmp"
    temp_path = os.path.join(tempfile.gettempdir(), temp_filename)
    
    try:
        manager = _get_wia_manager()
        device = None
        
        # Find and connect to the scanner
        for i in range(1, manager.DeviceInfos.Count + 1):
            device_info = manager.DeviceInfos.Item(i)
            if device_info.Type != WIA_DEVICE_TYPE_SCANNER:
                continue
            
            if scanner_id:
                # Match by device ID
                try:
                    for j in range(1, device_info.Properties.Count + 1):
                        prop = device_info.Properties.Item(j)
                        if prop.Name == "Unique Device ID" and prop.Value == scanner_id:
                            device = device_info.Connect()
                            break
                except Exception:
                    pass
            else:
                # Use first available scanner
                device = device_info.Connect()
            
            if device:
                break
        
        if not device:
            raise RuntimeError("No scanner found. Make sure your scanner is connected and powered on.")
        
        # Get the first scan item (flatbed)
        if device.Items.Count == 0:
            raise RuntimeError("Scanner has no scan items available.")
        
        item = device.Items(1)
        
        # Configure scan settings
        item_props = item.Properties
        
        # Set resolution
        _set_wia_property(item_props, WIA_IPS_XRES, dpi)
        _set_wia_property(item_props, WIA_IPS_YRES, dpi)
        
        # Set color mode
        if grayscale == 'bw':
            _set_wia_property(item_props, WIA_IPA_DATATYPE, WIA_DATA_BW)
            _set_wia_property(item_props, WIA_IPS_CUR_INTENT, WIA_INTENT_TEXT)
        elif grayscale is True or grayscale == 'grayscale':
            _set_wia_property(item_props, WIA_IPA_DATATYPE, WIA_DATA_GRAYSCALE)
            _set_wia_property(item_props, WIA_IPS_CUR_INTENT, WIA_INTENT_GRAYSCALE)
        else:
            _set_wia_property(item_props, WIA_IPA_DATATYPE, WIA_DATA_COLOR)
            _set_wia_property(item_props, WIA_IPS_CUR_INTENT, WIA_INTENT_COLOR)
        
        # Set brightness and contrast for better B&W output
        if grayscale is True or grayscale == 'grayscale':
            _set_wia_property(item_props, WIA_IPS_BRIGHTNESS, 0)
            _set_wia_property(item_props, WIA_IPS_CONTRAST, 0)
        
        logger.info(f"Starting scan at {dpi} DPI, mode={grayscale}")
        
        # Perform the scan - transfer image as BMP (most compatible)
        try:
            image_file = item.Transfer(WIA_IMG_FORMAT_BMP)
        except Exception as e:
            error_msg = str(e)
            if "0x80210006" in error_msg:
                raise RuntimeError("Scanner is busy. Please wait and try again.")
            elif "0x80210001" in error_msg:
                raise RuntimeError("Scanner communication error. Check the connection.")
            elif "0x80210064" in error_msg:
                raise RuntimeError("No document detected on the scanner. Place your document and try again.")
            else:
                raise RuntimeError(f"Scan failed: {error_msg}")
        
        # Save WIA image to a temporary file, then read it
        image_file.SaveFile(temp_path)
        
        # Open with Pillow for processing and conversion to PNG
        from PIL import Image
        
        img = Image.open(temp_path)
        
        # Convert to grayscale/L if not already
        if grayscale == 'bw':
            img = img.convert('L')
        elif (grayscale is True or grayscale == 'grayscale') and img.mode != 'L':
            img = img.convert('L')
        elif not grayscale and img.mode != 'RGB':
            img = img.convert('RGB')
        
        width, height = img.size
        
        # Convert to PNG base64
        buffer = BytesIO()
        img.save(buffer, format='PNG', optimize=True)
        buffer.seek(0)
        image_b64 = base64.b64encode(buffer.read()).decode('utf-8')
        
        logger.info(f"Scan complete: {width}x{height} pixels")
        
        return {
            'image': f"data:image/png;base64,{image_b64}",
            'width': width,
            'height': height
        }
    
    finally:
        # Clean up temp file and COM
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


def get_scanner_info(scanner_id=None):
    """
    Get detailed information about a scanner.
    
    Returns:
        dict with scanner properties like max resolution, scan area, etc.
    """
    import win32com.client
    
    manager = _get_wia_manager()
    
    for i in range(1, manager.DeviceInfos.Count + 1):
        device_info = manager.DeviceInfos.Item(i)
        if device_info.Type != WIA_DEVICE_TYPE_SCANNER:
            continue
        
        if scanner_id:
            found = False
            for j in range(1, device_info.Properties.Count + 1):
                prop = device_info.Properties.Item(j)
                if prop.Name == "Unique Device ID" and prop.Value == scanner_id:
                    found = True
                    break
            if not found:
                continue
        
        device = device_info.Connect()
        item = device.Items(1)
        
        info = {
            'name': '',
            'max_dpi': 300,
            'supported_dpi': [150, 200, 300, 600],
        }
        
        # Get device name
        for j in range(1, device_info.Properties.Count + 1):
            prop = device_info.Properties.Item(j)
            if prop.Name == "Name":
                info['name'] = prop.Value
                break
        
        # Get max resolution
        max_x = _get_wia_property(item.Properties, WIA_IPS_XRES)
        if max_x:
            info['max_dpi'] = max_x
        
        return info
    
    return None
