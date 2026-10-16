"""Inspect the two disposable PDFs downloaded by academic-years-browser.cjs.
Usage: python tests/annual-report-pdf-check.py <TEST_PDF_DIR>
Render separately with pdftoppm; contact sheets help review every rendered page.
"""
import re
import json
import sys
from pathlib import Path
import pdfplumber
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw

directory = Path(sys.argv[1]).resolve()
reports = {}
for cycle in ("2026-2027", "2027-2028"):
    filename = directory / f"Reporte de Prueba local - {cycle}.pdf"
    reader = PdfReader(filename)
    content = " ".join(" ".join(page.extract_text().split()) for page in reader.pages)
    assert "Prueba local" in content
    assert "Generado por AC Edunity" in content
    assert "REPORTE ACADÉMICO" in reader.pages[0].extract_text()
    if cycle == "2026-2027":
        assert "No se registraron metas durante este año lectivo." in content
    assert "RESUMEN ACADÉMICO DEL AÑO" in reader.pages[1].extract_text()
    assert "BALANCE DE ACTIVIDAD" in reader.pages[1].extract_text()
    if cycle == "2027-2028":
        for heading, detail in (("EVALUACIONES", "ACTUAL 2027 Evaluación"), ("CALENDARIO Y EVENTOS", "ACTUAL 2027 Evento"), ("RECURSOS DE ESTUDIO", "ACTUAL 2027 Recurso")):
            page_text = next(page.extract_text() for page in reader.pages if heading in page.extract_text())
            assert detail in " ".join(page_text.split()), f"Orphaned heading: {heading}"
        assert "PROGRESO DEL ESTUDIANTE" in reader.pages[-1].extract_text(), "Avoid an almost empty closing-only page"
    for section in ("MATERIAS DEL AÑO", "ACTIVIDAD DE TAREAS", "EVALUACIONES", "RENDIMIENTO ACADÉMICO",
                    "ASISTENCIA", "METAS", "PROYECTOS", "DETALLE DE PROYECTOS", "CALENDARIO Y EVENTOS", "RECURSOS DE ESTUDIO", "PROGRESO DEL ESTUDIANTE", "FIN DEL REPORTE"):
        assert section in content, f"Missing section: {section}"
    for technical in ("snapshot", "UUID", "registro fuente", "fila recuperable", "hijos conservados", "preparing", "pending_internal", "completed_internal", "Balance del año", "Conservada"):
        assert technical not in content, f"Technical/redundant wording: {technical}"
    assert "continuación" not in content, "The complete progress grid must fit on a single page"
    for i, page in enumerate(reader.pages, 1):
        assert abs(float(page.mediabox.width) - 595.28) < 1
        assert abs(float(page.mediabox.height) - 841.89) < 1
        assert f"Página {i} de {len(reader.pages)}" in " ".join(page.extract_text().split())
        if "PROGRESO DEL ESTUDIANTE" in page.extract_text():
            metrics_grid = ("XP del año", "Nivel alcanzado", "Días activos", "Actividades registradas", "Racha", "Tareas completadas")
            assert all(label in page.extract_text() for label in metrics_grid), "Progress heading must stay with all six metric cards"
    if "REGISTROS HISTÓRICOS ANTERIORES" in content:
        assert "REGISTROS HISTÓRICOS ANTERIORES" in reader.pages[-1].extract_text()
        assert "FIN DEL REPORTE" in reader.pages[-1].extract_text(), "History and closing must stay together"
    with pdfplumber.open(filename) as pdf:
        for page in pdf.pages:
            assert "Reporte académico de Prueba local" in page.extract_text()
            assert len(page.chars) > 150, f"Unexpected blank page: {page.page_number}"
            # No large colored rectangles; white paper and small table headers only.
            def light(color):
                if isinstance(color, (int, float)):
                    return color >= .85
                return color is None or sum(color) / len(color) >= .85
            assert not [r for r in page.rects if r["height"] > 50 and r["width"] > 100 and
                        not light(r.get("non_stroking_color"))], f"Dark block on page {page.page_number}"
            outside = [char for char in page.chars if char["text"].strip() and
                       (char["x0"] < 0 or char["x1"] > page.width + 0.5 or
                        char["top"] < 0 or char["bottom"] > page.height + 0.5)]
            assert not outside, f"Text outside page: {filename.name}, page {page.page_number}"
            assert all(char["x0"] >= 50 and char["x1"] <= page.width - 50 for char in page.chars if char["text"].strip()), \
                f"Text outside side margins: {filename.name}, page {page.page_number}"
            for shape in page.curves:
                if shape['height'] > 10 and shape['width'] > 30:
                    assert shape['top'] >= 0 and shape['bottom'] <= 774, f"Card crosses page/footer boundary: page {page.page_number}"
    reports[cycle] = content
    print(f"PASS PDF {cycle}: {len(reader.pages)} A4 pages; correct name, headers/footer, no text outside page.")
assert "Materia histórica" in reports["2026-2027"]
assert "Materia histórica" not in reports["2027-2028"]
assert "ACTUAL 2027" not in reports["2026-2027"]
assert "PRUEBA AÑO LECTIVO" not in reports["2026-2027"]
assert "PRUEBA AÑO LECTIVO" in reports["2027-2028"]
for n in range(1, 181):
    assert f"Tarea extensa {n} - Investigación" in reports["2027-2028"], f"Missing task {n}"
    assert len(re.findall(rf"Tarea extensa {n} - Investigación", reports["2027-2028"])) == 1, f"Duplicated task {n}"
assert "12:00 PM" in reports["2027-2028"]
assert "private.example" not in reports["2027-2028"]
assert "ANTERIOR AL HISTORIAL" not in reports["2026-2027"], "A missing title must never be fabricated from activity"
assert "REGISTROS HISTÓRICOS ANTERIORES" in reports["2026-2027"]
assert "8.10" in reports["2027-2028"]
assert "100%" in reports["2027-2028"]
assert "Eliminada posteriormente" in reports["2027-2028"]
assert "Completada" in reports["2027-2028"]
metrics = json.loads((directory / "metrics-2027.json").read_text())
assert metrics["history"]["tasks"] == {"total": 181, "retained": 171, "deleted": 10}
assert metrics["taskCounts"]["completed"] == 60
assert sum(metrics["taskCounts"].values()) == 181
print("PASS: all 180 long task titles retained; no cross-year data; AM/PM preserved.")

for prefix in ("actual", "historico"):
    pages = sorted(directory.glob(f"{prefix}-*.png"))
    assert pages, "Render the latest PDFs before inspecting them"
    for page in pages:
        image = Image.open(page).convert("RGB")
        # Paper around every page and the old dark cover area is now pure white.
        for x, y in ((5, 5), (image.width - 6, 5), (5, image.height - 6), (image.width - 6, image.height - 6)):
            assert min(image.getpixel((x, y))) >= 250, f"Non-white paper: {page.name}"
        if page == pages[0]:
            for x in (image.width // 5, image.width * 4 // 5):
                assert min(image.getpixel((x, image.height // 10))) >= 250, f"Old dark cover: {page.name}"
    for start in range(0, len(pages), 6):
        batch = pages[start:start + 6]
        sheet = Image.new("RGB", (1200, 1160), "#d9ddea")
        draw = ImageDraw.Draw(sheet)
        for index, page in enumerate(batch):
            image = Image.open(page).convert("RGB")
            image.thumbnail((380, 540))
            x, y = (index % 3) * 400 + 10, (index // 3) * 580 + 20
            sheet.paste(image, (x, y))
            draw.text((x, y + 545), page.stem, fill="black")
        sheet.save(directory / f"review-{prefix}-{start // 6 + 1}.png")
