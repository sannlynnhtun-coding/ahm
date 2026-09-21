Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\src\Ahm\wwwroot'
$source = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($source)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.ScaleTransform(10.24, 10.24)

$tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
$tile.AddArc(2, 2, 48, 48, 180, 90)
$tile.AddArc(50, 2, 48, 48, 270, 90)
$tile.AddArc(50, 50, 48, 48, 0, 90)
$tile.AddArc(2, 50, 48, 48, 90, 90)
$tile.CloseFigure()
$green = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#14534c'))
$ivory = [System.Drawing.ColorTranslator]::FromHtml('#fff9ed')
$gold = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#eab94f'))
$graphics.FillPath($green, $tile)

$loop = [System.Drawing.Drawing2D.GraphicsPath]::new()
$loop.StartFigure()
$loop.AddLine(63, 29, 40, 29)
$loop.AddBezier(40, 29, 26, 29, 18, 40, 18, 54)
$loop.AddBezier(18, 54, 18, 69, 27, 78, 40, 78)
$loop.AddLine(40, 78, 63, 78)
$loop.AddBezier(63, 78, 77, 78, 84, 69, 84, 56)
$loop.AddLine(84, 56, 84, 49)
$pen = [System.Drawing.Pen]::new($ivory, 11)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawPath($pen, $loop)
$graphics.FillEllipse($gold, 68, 21, 18, 18)
$graphics.Dispose()
$tile.Dispose()
$loop.Dispose()
$green.Dispose()
$gold.Dispose()
$pen.Dispose()

$targets = @(
    @{ Name = 'favicon.png'; Size = 32 },
    @{ Name = 'apple-touch-icon.png'; Size = 180 },
    @{ Name = 'icon-192.png'; Size = 192 },
    @{ Name = 'icon-512.png'; Size = 512 },
    @{ Name = 'brand-mark.png'; Size = 1024 }
)
foreach ($target in $targets) {
    $size = $target.Size
    $image = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $canvas = [System.Drawing.Graphics]::FromImage($image)
    $canvas.Clear([System.Drawing.Color]::Transparent)
    $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $canvas.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $canvas.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
    $canvas.Dispose()
    $image.Save((Join-Path $outputDirectory $target.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $image.Dispose()
}
$source.Dispose()
