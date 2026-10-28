// Controlled, mathematically verified responses, not claims about live model accuracy.
module.exports = [
    { id: 'sum', title: 'Suma de fracciones', question: 'Suma 1/2 y 1/3', result: [5, 6],
        answer: String.raw`## Suma de fracciones
Usamos el denominador común 6: \(\frac{1}{2}=\frac{3}{6}\) y \(\frac{1}{3}=\frac{2}{6}\).
\[\frac{1}{2}+\frac{1}{3}=\frac{3+2}{6}=\frac{5}{6}\]
Comprobación: 5/6 es aproximadamente 0,8333.` },
    { id: 'subtract', title: 'Resta de fracciones', result: [7, 12], answer: String.raw`## Resta
\[\frac{5}{6}-\frac{1}{4}=\frac{10}{12}-\frac{3}{12}=\frac{7}{12}\]` },
    { id: 'multiply', title: 'Multiplicación de fracciones', result: [2, 5], answer: String.raw`## Multiplicación
\[\frac{2}{3}\times\frac{3}{5}=\frac{6}{15}=\frac{2}{5}\]` },
    { id: 'divide', title: 'División de fracciones', result: [15, 8], answer: String.raw`## División
Multiplicamos por el recíproco, que existe porque el divisor no es cero.
\[\frac{3}{4}\div\frac{2}{5}=\frac{3}{4}\times\frac{5}{2}=\frac{15}{8}\]` },
    { id: 'simplify', title: 'Simplificar 12/8', result: [3, 2], answer: String.raw`## Simplificar 12/8
1. El máximo común divisor de 12 y 8 es **4**.
2. Dividimos el numerador y el denominador entre 4.
\[\frac{12}{8}=\frac{12\div4}{8\div4}=\frac{3}{2}\]
3. Comprobación: \(\frac{3}{2}=1,5=\frac{12}{8}\).` },
    { id: 'powers', title: 'Potencias y raíces', answer: String.raw`## Potencias y raíces
\(2^3=2\times2\times2=8\). La raíz principal es \(\sqrt{49}=7\), porque \(7^2=49\).` },
    { id: 'linear', title: 'Ecuación lineal', answer: String.raw`## Ecuación lineal
\[3x-7=2x+5\]
Restamos \(2x\) y sumamos 7 en ambos miembros: \(x=12\).
Comprobación: \(3(12)-7=29=2(12)+5\).` },
    { id: 'quadratic', title: 'Ecuación cuadrática', answer: String.raw`## Ecuación cuadrática
\[x^2-5x+6=0\]
\[x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}=\frac{5\pm\sqrt{25-24}}{2}=\frac{5\pm1}{2}\]
Las soluciones son \(x=2\) y \(x=3\). Comprobación: \((x-2)(x-3)=x^2-5x+6\).` },
    { id: 'system', title: 'Sistema de ecuaciones', answer: String.raw`## Sistema de ecuaciones
\[\begin{cases}2x+y=7\\x-y=2\end{cases}\]
Sumamos ambas ecuaciones: \(3x=9\), por tanto \(x=3\). Luego \(y=x-2=1\).
Comprobación: \(2(3)+1=7\) y \(3-1=2\).` },
    { id: 'calculus', title: 'Integrales y derivadas', answer: String.raw`## Cálculo básico
\[\int 2x\,dx=x^2+C\]
La derivada verifica el resultado: \(\frac{d}{dx}(x^2+C)=2x\).
\[\frac{d}{dx}x^3=3x^2\]` },
    { id: 'mixed', title: 'Delimitadores y texto', answer: String.raw`## Texto y fórmulas
En una frase: $a^2+b^2=c^2$. En una línea independiente:
$$\sqrt{a^2+b^2}=c$$
Con paréntesis: \(\left(\frac{2}{3}\right)^2=\frac{4}{9}\).
Con escape duplicado histórico: \\(\\frac{12}{8}=\\frac{3}{2}\\).` },
    { id: 'invalid', title: 'Fórmula inválida aislada', answer: String.raw`## Entrada mal formada
Esta expresión no está completa: \(\frac{1}{\).
El resto sigue siendo legible y válido: \(\sqrt{9}=3\).` },
    { id: 'code', title: 'Código sin interpretar', answer: '## Código normal\n\n```js\nconst formula = "\\frac{12}{8}";\nconst currency = "$5";\n```\n\nInline: `\\(x^2\\)` no se interpreta. Fuera del código sí: \\(x^2\\).'
    }
];
