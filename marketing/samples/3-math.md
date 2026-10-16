### Why 0.4 is the light/dark cut-off

Relative luminance weights the linear sRGB channels:

$$
L = 0.2126\,R_{\text{lin}} + 0.7152\,G_{\text{lin}} + 0.0722\,B_{\text{lin}},
\qquad
C_{\text{lin}} =
\begin{cases}
\dfrac{C}{12.92} & C \le 0.04045 \\
\left(\dfrac{C + 0.055}{1.055}\right)^{2.4} & \text{otherwise}
\end{cases}
$$

The contrast of text on a background is $\dfrac{L_1 + 0.05}{L_2 + 0.05}$. At $L = 0.4$, black text has a contrast of $9.0$ and white text only $2.3$. So a background above $0.4$ reads as **light**.

For Ghostty's default `#282c34`: $L \approx 0.025$, so the mode is **dark**.
