# -*- coding: utf-8 -*-
"""
ColorVerse 关卡生成器 v2
输入: 彩色原图 + 线稿
管线: Lab -> SLIC 超像素 -> 颜色聚合 -> 线稿切分 -> 就近吸收
      -> Moore 轮廓追踪 -> Douglas-Peucker 简化 -> SVG path -> level.json
输出: level.json / preview.png / outline.png / source.json / verify_fill.png
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------- 参数 ----------------
WORK_W = 1200                 # 工作宽度(高度按线稿比例)
N_SEG = 500                   # SLIC 超像素数
SLIC_M = 10.0                 # SLIC 紧凑度
MERGE_THRESH = 14.0           # Lab 聚合阈值
MIN_AREA_RATIO = 0.0008       # 最小区域面积占比(小于则并入邻区, 线稿围合的小区域除外)
PALETTE_N = 14                # 调色板色数
DP_EPS = 1.4                  # 轮廓简化容差(像素)
DILATE_IT = 1                 # 线稿膨胀次数(过大会吃掉字母等细小区域)
PROTECT_MIN_AREA = 150        # 线稿围合小区域的保护下限(像素), 低于此仍并入邻区
PROTECT_WALL_FRAC = 0.6       # 边界贴墙占比达到该值才算"线稿围合"

DIRS = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]  # 顺时针 N..NW
DIR_IDX = {d: i for i, d in enumerate(DIRS)}


def rgb2lab(arr):
    a = arr / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    X = lin[..., 0] * 0.4124 + lin[..., 1] * 0.3576 + lin[..., 2] * 0.1805
    Y = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    Z = lin[..., 0] * 0.0193 + lin[..., 1] * 0.1192 + lin[..., 2] * 0.9505
    X, Y, Z = X / 0.95047, Y / 1.0, Z / 1.08883
    f = lambda t: np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16 / 116)
    fx, fy, fz = f(X), f(Y), f(Z)
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1).astype(np.float32)


def box_blur(img, iters=2):
    m = img
    for _ in range(iters):
        p = np.pad(m, ((1, 1), (1, 1), (0, 0)), mode="edge")
        acc = np.zeros_like(m)
        for dy in range(3):
            for dx in range(3):
                acc += p[dy:dy + m.shape[0], dx:dx + m.shape[1]]
        m = acc / 9.0
    return m


def slic(lab_map, n_seg, m_weight, iters=10):
    H, W = lab_map.shape[:2]
    S = max(4, int(np.sqrt(H * W / n_seg)))
    xs = np.arange(S // 2, W, S)
    ys = np.arange(S // 2, H, S)
    centers = np.array([[lab_map[y, x, 0], lab_map[y, x, 1], lab_map[y, x, 2], x, y]
                        for y in ys for x in xs], dtype=np.float32)
    K = len(centers)
    labels = np.zeros((H, W), dtype=np.int32)
    dist = np.full((H, W), np.inf, dtype=np.float32)
    for _ in range(iters):
        dist[:] = np.inf
        for k in range(K):
            cl, ca, cb, cx, cy = centers[k]
            x0, x1 = max(0, int(cx - S)), min(W, int(cx + S + 1))
            y0, y1 = max(0, int(cy - S)), min(H, int(cy + S + 1))
            dc = ((lab_map[y0:y1, x0:x1, 0] - cl) ** 2 +
                  (lab_map[y0:y1, x0:x1, 1] - ca) ** 2 +
                  (lab_map[y0:y1, x0:x1, 2] - cb) ** 2)
            yy, xx = np.mgrid[y0:y1, x0:x1]
            d = dc + ((xx - cx) ** 2 + (yy - cy) ** 2) * (m_weight / S) ** 2
            upd = d < dist[y0:y1, x0:x1]
            dist[y0:y1, x0:x1][upd] = d[upd]
            labels[y0:y1, x0:x1][upd] = k
        # 用 bincount 向量化更新中心, 避免 K 次全图布尔扫描
        flat = labels.ravel()
        cnt = np.bincount(flat, minlength=K).astype(np.float64)
        yy, xx = np.mgrid[0:H, 0:W]
        sL = np.bincount(flat, weights=lab_map[..., 0].ravel(), minlength=K)
        sa = np.bincount(flat, weights=lab_map[..., 1].ravel(), minlength=K)
        sb = np.bincount(flat, weights=lab_map[..., 2].ravel(), minlength=K)
        sx = np.bincount(flat, weights=xx.ravel(), minlength=K)
        sy = np.bincount(flat, weights=yy.ravel(), minlength=K)
        nonempty = cnt > 0
        centers[nonempty] = np.stack([sL, sa, sb, sx, sy], axis=1)[nonempty] / cnt[nonempty, None]
    return labels, K


def dilate(mask, it=1):
    m = mask
    for _ in range(it):
        p = np.pad(m, 1, constant_values=False)
        m = (p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] |
             p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:] | p[1:-1, 1:-1])
    return m


def split_by_wall(labels, wall):
    """标签图被墙横穿的区域, 沿墙切开重新标记连通域"""
    H, W = labels.shape
    free = ~wall
    final = np.full((H, W), -1, dtype=np.int32)
    fid = 0
    for r in np.unique(labels):
        m = (labels == r) & free
        ys, xs = np.where(m)
        for y, x in zip(ys, xs):
            if final[y, x] != -1:
                continue
            q = deque([(y, x)]); final[y, x] = fid
            while q:
                cy, cx = q.popleft()
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and final[ny, nx] == -1:
                        final[ny, nx] = fid; q.append((ny, nx))
            fid += 1
    return final, fid


def absorb_small(labels, n, min_area, wall):
    """小于 min_area 的区域并入邻区; 但被线稿围合的小区域(如字母内腔)保留"""
    counts = np.bincount((labels + 2).ravel(), minlength=n + 2)[2:]
    # 一次性向量化统计每个区域的边界长度 和 其中贴墙的长度
    boundary = np.zeros(n, dtype=np.int64)
    wall_edge = np.zeros(n, dtype=np.int64)
    for a, b in ((labels[:-1, :], labels[1:, :]), (labels[:, :-1], labels[:, 1:])):
        diff = a != b
        for side, other in ((a, b), (b, a)):
            m = diff & (side >= 0)
            np.add.at(boundary, side[m], 1)
            np.add.at(wall_edge, side[m & (other == -1)], 1)
    kill = np.zeros(n, dtype=bool)
    for i in range(n):
        if counts[i] >= min_area:
            continue
        # 线稿围合且面积达到保护下限的小区域(如字母内腔)保留, 其余噪点并入邻区
        if (counts[i] >= PROTECT_MIN_AREA and boundary[i] > 0
                and wall_edge[i] / boundary[i] >= PROTECT_WALL_FRAC):
            continue
        kill[i] = True
    # 单次 LUT 抹除, 避免每个小区域一次全图扫描
    lut = np.arange(-2, n, dtype=np.int32)  # lut[label + 2] -> 新值; 墙(-1)保持 -1
    lut[2:][kill] = -2
    labels = lut[labels + 2]
    H, W = labels.shape
    q = deque(zip(*np.where(labels >= 0)))
    while q:
        cy, cx = q.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < H and 0 <= nx < W and labels[ny, nx] == -2:
                labels[ny, nx] = labels[cy, cx]; q.append((ny, nx))
    # 只压缩非负标签, 墙(-1)保持为 -1, 不参与区域编号
    out = np.full(labels.shape, -1, dtype=np.int32)
    free_mask = labels >= 0
    uniq, inv = np.unique(labels[free_mask], return_inverse=True)
    out[free_mask] = inv
    return out, len(uniq)


# ---------------- 轮廓追踪 ----------------
def trace_ring(mask, start, bd):
    """Moore 邻域追踪, Jacob 停止准则。bd: 从 start 指向背景来向的方向索引"""
    H, W = mask.shape
    s = start
    boundary = [s]
    p = s
    second = None
    max_iter = int(mask.sum()) * 4 + 100
    for _ in range(max_iter):
        nxt = None
        for i in range(1, 9):
            j = (bd + i) % 8
            q = (p[0] + DIRS[j][0], p[1] + DIRS[j][1])
            if 0 <= q[0] < H and 0 <= q[1] < W and mask[q]:
                nxt = (q, (bd + i) % 8)
                break
        if nxt is None:
            break  # 孤立像素
        q, jq = nxt
        if p == s and second is not None and q == second:
            break
        if second is None:
            second = q
        # 新回溯像素 = 扫描到 q 之前的那个像素(相对 p 的方向 jq-1)
        pj = DIRS[(jq - 1) % 8]
        pb = (p[0] + pj[0], p[1] + pj[1])
        bd = DIR_IDX[(pb[0] - q[0], pb[1] - q[1])]
        boundary.append(q)
        p = q
    return boundary


def signed_area(ring):
    a = 0.0
    for i in range(len(ring)):
        y0, x0 = ring[i]
        y1, x1 = ring[(i + 1) % len(ring)]
        a += x0 * y1 - x1 * y0
    return a / 2.0


def dp_simplify(ring, eps):
    """Douglas-Peucker, 输入为闭合环(不含重复终点)"""
    n = len(ring)
    if n < 6:
        return ring
    pts = np.array(ring, dtype=np.float64)  # (y, x)
    keep = np.zeros(n, dtype=bool)
    # 以距质心最远的点作为起点, 避免接缝处被削
    c = pts.mean(0)
    i0 = int(np.argmax(((pts - c) ** 2).sum(1)))
    keep[i0] = True
    i1 = int(np.argmax(((pts - pts[i0]) ** 2).sum(1)))
    keep[i1] = True
    stack = [(i0, i1), (i1, i0)]
    while stack:
        a, b = stack.pop()
        pa, pb = pts[a], pts[b]
        # 沿环从 a 走到 b
        idx = []
        i = a
        while i != b:
            idx.append(i)
            i = (i + 1) % n
        if len(idx) < 2:
            continue
        seg = pb - pa
        seg_len2 = float((seg ** 2).sum())
        P = pts[idx]
        if seg_len2 == 0:
            d = np.sqrt(((P - pa) ** 2).sum(1))
        else:
            t = np.clip(((P - pa) @ seg) / seg_len2, 0, 1)
            proj = pa + t[:, None] * seg[None, :]
            d = np.sqrt(((P - proj) ** 2).sum(1))
        im = int(np.argmax(d))
        if d[im] > eps:
            mid = idx[im]
            keep[mid] = True
            stack.append((a, mid))
            stack.append((mid, b))
    out = [ring[i] for i in range(n) if keep[i]]
    return out if len(out) >= 3 else ring


def region_rings(labels, rid):
    """返回 (外环, [内环...]), 坐标为 (y, x)。只在区域 bbox 裁剪窗口内做补集 BFS, 避免全图扫描"""
    mask = labels == rid
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return None, []
    H, W = mask.shape
    y0, y1 = max(0, int(ys.min()) - 2), min(H, int(ys.max()) + 3)
    x0, x1 = max(0, int(xs.min()) - 2), min(W, int(xs.max()) + 3)
    crop = mask[y0:y1, x0:x1]
    padded = np.pad(crop, 1, constant_values=False)
    # 补集连通域: 接触边框的是外部, 其余是洞
    comp = ~padded
    cH, cW = comp.shape
    comp_labels = np.full(comp.shape, -1, dtype=np.int32)
    comp_ids = []
    cid = 0
    for y in range(cH):
        for x in range(cW):
            if comp[y, x] and comp_labels[y, x] == -1:
                q = deque([(y, x)]); comp_labels[y, x] = cid
                touches_border = (y == 0 or x == 0 or y == cH - 1 or x == cW - 1)
                while q:
                    cy, cx = q.popleft()
                    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < cH and 0 <= nx < cW and comp[ny, nx] and comp_labels[ny, nx] == -1:
                            comp_labels[ny, nx] = cid; q.append((ny, nx))
                            if ny == 0 or nx == 0 or ny == cH - 1 or nx == cW - 1:
                                touches_border = True
                comp_ids.append((cid, touches_border))
                cid += 1
    rings = []
    for cid_i, is_outer in comp_ids:
        # 用 numpy 找该补集连通域 4-邻接的区域像素(比遍历 cells 快)
        comp_mask = comp_labels == cid_i
        adj_region = dilate(comp_mask, 1) & padded
        ays, axs = np.where(adj_region)
        if len(ays) == 0:
            continue
        start = (int(ays[0]), int(axs[0]))  # 最上最左
        bd = None
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = start[0] + dy, start[1] + dx
            if 0 <= ny < cH and 0 <= nx < cW and comp_mask[ny, nx]:
                bd = DIR_IDX[(dy, dx)]
                break
        if bd is None:
            continue
        ring = trace_ring(padded, start, bd)
        if len(ring) >= 3:
            rings.append((is_outer, ring))
    if not rings:
        return None, []
    outer = max((r for r in rings if r[0]), key=lambda r: abs(signed_area(r[1])), default=None)
    if outer is None:
        outer = max(rings, key=lambda r: abs(signed_area(r[1])))
    holes = [r for r in rings if not r[0] and r is not outer]
    # 坐标从 padded 换回: -1 去 padding, +y0/x0 还原裁剪偏移
    outer_ring = [(y - 1 + y0, x - 1 + x0) for y, x in outer[1]]
    hole_rings = [[(y - 1 + y0, x - 1 + x0) for y, x in r[1]] for r in holes]
    return outer_ring, hole_rings


def ring_to_path(ring, must_contain=None):
    """简化成 SVG path。若给了 must_contain((y,x) 区域内部点),
    简化结果必须包含该点, 否则逐步降低简化强度直至用原始环"""
    for eps in (DP_EPS, 0.7, 0.3, 0):
        pts = dp_simplify(ring, eps) if eps > 0 else ring
        if must_contain is not None and not point_in_poly(must_contain, pts):
            continue
        cmds = [f"M{pts[0][1]:.1f} {pts[0][0]:.1f}"]
        cmds += [f"L{p[1]:.1f} {p[0]:.1f}" for p in pts[1:]]
        cmds.append("Z")
        return "".join(cmds)
    pts = ring
    cmds = [f"M{pts[0][1]:.1f} {pts[0][0]:.1f}"]
    cmds += [f"L{p[1]:.1f} {p[0]:.1f}" for p in pts[1:]]
    cmds.append("Z")
    return "".join(cmds)


def point_in_poly(pt, ring):
    """射线法, pt=(y,x), ring=[(y,x),...]"""
    y, x = pt
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if (xi > x) != (xj > x) and y < (yj - yi) * (x - xi) / ((xj - xi) or 1e-9) + yi:
            inside = not inside
        j = i
    return inside


def generate_level(color_src, line_src, out_dir, level_id, title=None,
                   n_seg=None, merge_thresh=None, palette_n=None, min_area_ratio=None,
                   target_range=None, progress=None):
    """彩色原图 + 可选线稿 -> level 文件组。line_src 传 None 为纯照片模式(梯度边缘当墙)
    target_range=(lo, hi): 区域数建议值，用于调节聚合强度而非验收条件。
    hi 可为 None，表示只有建议下限、没有区域数上限。"""
    n_seg = n_seg or N_SEG
    merge_thresh = merge_thresh or MERGE_THRESH
    palette_n = palette_n or PALETTE_N
    min_area_ratio = min_area_ratio or MIN_AREA_RATIO
    out_dir = Path(out_dir)
    title = title or level_id
    out_dir.mkdir(parents=True, exist_ok=True)

    color_img = Image.open(color_src).convert("RGB")
    if line_src:
        line_img = Image.open(line_src).convert("L")
        W0, H0 = line_img.size
    else:
        line_img = None
        W0, H0 = color_img.size
    scale = WORK_W / W0
    W, H = WORK_W, round(H0 * scale)
    if line_img is not None:
        line_img = line_img.resize((W, H), Image.LANCZOS)
    rgb = np.asarray(color_img.resize((W, H), Image.LANCZOS), dtype=np.float32)
    if progress:
        progress("preprocess", "running", f"已统一画布为 {W} × {H}")
    print(f"[1/6] 工作尺寸 {W}x{H} ({'线稿' if line_src else '照片'}模式)", flush=True)

    # 1. Lab + SLIC（线稿已在上游单独生成，这里只把它当作区域边界约束）
    if progress:
        progress("segment", "running", "正在识别颜色相近的画面区域")
    lab = rgb2lab(box_blur(rgb, 2))
    sp, K = slic(lab, n_seg, SLIC_M)
    print(f"[2/6] SLIC 超像素 {K}")

    # 2. 相邻超像素按 Lab 色差聚合(bincount 向量化求均值)
    flat_sp = sp.ravel()
    sp_cnt = np.bincount(flat_sp, minlength=K).astype(np.float64)
    sp_color = np.zeros((K, 3), dtype=np.float32)
    for c in range(3):
        s = np.bincount(flat_sp, weights=lab[..., c].ravel(), minlength=K)
        sp_color[:, c] = (s / np.maximum(sp_cnt, 1)).astype(np.float32)
    adj = [set() for _ in range(K)]
    a, b = sp[:-1, :], sp[1:, :]
    for y, x in zip(*np.where(a != b)):
        adj[a[y, x]].add(b[y, x]); adj[b[y, x]].add(a[y, x])
    a, b = sp[:, :-1], sp[:, 1:]
    for y, x in zip(*np.where(a != b)):
        adj[a[y, x]].add(b[y, x]); adj[b[y, x]].add(a[y, x])
    parent = list(range(K))
    edges = []
    for k in range(K):
        for j in adj[k]:
            if j > k:
                edges.append((float(np.linalg.norm(sp_color[k] - sp_color[j])), k, j))
    edges.sort()

    # 3. 墙: 优先使用上游 Coloring Book Line Art；仅兼容旧入口才回退到照片边缘。
    if line_img is not None:
        lines = np.asarray(line_img, dtype=np.uint8) < 128
    else:
        gray = box_blur(rgb, 1).mean(axis=2)
        gx = np.zeros((H, W), dtype=np.float32)
        gy = np.zeros((H, W), dtype=np.float32)
        gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
        gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
        mag = np.hypot(gx, gy)
        edge_t = max(float(np.percentile(mag, 88)), 10.0)
        lines = mag > edge_t
        print(f"[3/6] 照片边缘墙: 阈值 {edge_t:.1f}, 覆盖 {float(lines.mean()) * 100:.1f}%")
    wall = dilate(lines, DILATE_IT)

    # 4. 自适应聚合: 区域数建议值只影响生成参数，不作为关卡验收上限。
    #    困难档没有上限，复杂线稿应保留为可玩的困难关卡，而不是继续强制合并。
    lo, hi = target_range or (1, None)
    target_label = f'{lo}+' if hi is None else f'{lo}~{hi}'
    min_area = int(W * H * min_area_ratio)
    thresh = float(merge_thresh)
    final = None
    nregion = 0
    for attempt in range(5):
        parent = list(range(K))
        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]; i = parent[i]
            return i
        for d, k, j in edges:
            if d >= thresh:
                break
            rk, rj = find(k), find(j)
            if rk != rj:
                parent[rj] = rk
        merged = np.vectorize(find)(sp).reshape(H, W).astype(np.int32)
        final, fid = split_by_wall(merged, wall)
        final, nregion = absorb_small(final, fid, min_area, wall)
        print(f"[4/6] 第{attempt + 1}轮 阈值{thresh:.1f} -> {nregion} 块(建议 {target_label})", flush=True)
        if nregion < lo and thresh > 2.5:
            thresh *= 0.6
        elif hi is not None and nregion > hi and thresh < 80:
            thresh *= 1.6
        else:
            break
    print(f"[5/6] 聚合完成 {nregion} 块(小区域阈值 {min_area}px)")

    # 4. 区域描边 + 排序(从上到下从左到右, id 稳定)
    order = []
    for r in range(nregion):
        ys, xs = np.where(final == r)
        order.append((ys.min(), xs.min(), r))
    order.sort()

    # 5. 调色板: 区域均值色按面积加权 k-means
    if progress:
        progress("palette", "running", "正在归纳原图中的建议颜色")
    means, areas = [], []
    for _, _, r in order:
        m = final == r
        means.append(rgb[m].mean(0))
        areas.append(int(m.sum()))
    means = np.array(means, dtype=np.float32)
    areas = np.array(areas, dtype=np.float32)
    rng = np.random.default_rng(11)
    nc = min(palette_n, len(means))
    centers = means[rng.choice(len(means), nc, replace=False)].copy()
    for _ in range(30):
        d = ((means[:, None, :] - centers[None, :, :]) ** 2).sum(-1)
        asg = d.argmin(1)
        for k in range(nc):
            sel = asg == k
            if sel.any():
                centers[k] = (means[sel] * areas[sel, None]).sum(0) / areas[sel].sum()
    palette = ["#%02x%02x%02x" % tuple(int(round(c)) for c in centers[k]) for k in range(nc)]

    # 6. 轮廓 -> SVG path
    if progress:
        progress("vectorize", "running", f"正在整理 {nregion} 个可点击区域")
    regions = []
    regions_meta = []
    mask_ids = {}
    for num, (idx, (_, _, r)) in enumerate(enumerate(order), start=1):
        outer_ring, hole_rings = region_rings(final, r)
        if outer_ring is None:
            continue
        # 先定 label(区域内距质心最近的像素), 作为轮廓简化必须包含的点
        ys, xs = np.where(final == r)
        cy, cx = ys.mean(), xs.mean()
        li = int(np.argmin((ys - cy) ** 2 + (xs - cx) ** 2))
        label_pt = (float(ys[li]), float(xs[li]))
        oa = signed_area(outer_ring)
        d = ring_to_path(outer_ring, must_contain=label_pt)
        for hr in hole_rings:
            if (signed_area(hr) > 0) == (oa > 0):
                hr = hr[::-1]  # 内环反向, nonzero 填充下形成镂空
            d += ring_to_path(hr)
        regions.append({
            "id": f"r-{num:04d}",
            "maskId": num,
            "color": int(asg[idx]),
            "shape": {"kind": "path", "d": d},
            "label": {"x": round(label_pt[1], 1), "y": round(label_pt[0], 1)},
        })
        mask_ids[r] = num
        regions_meta.append({
            "id": num,
            "regionId": f"r-{num:04d}",
            "area": int(len(ys)),
            "bbox": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
            "centroid": [round(float(label_pt[1]), 1), round(float(label_pt[0]), 1)],
            "defaultColor": palette[int(asg[idx])],
            "fillable": True,
        })

    # 游戏逻辑专用：每个区域写入稳定的 uint16 ID；0 代表边界/不可填色。
    region_mask = np.zeros((H, W), dtype=np.uint16)
    for region_label, mask_id in mask_ids.items():
        region_mask[final == region_label] = mask_id
    Image.fromarray(region_mask, mode="I;16").save(out_dir / "region_mask.png")
    # 浏览器 Canvas 读取 16-bit PNG 会丢失精度，因此同步输出 RGB 编码：R=低8位，G=高8位。
    web_mask = np.zeros((H, W, 4), dtype=np.uint8)
    web_mask[..., 0] = (region_mask & 255).astype(np.uint8)
    web_mask[..., 1] = ((region_mask >> 8) & 255).astype(np.uint8)
    web_mask[..., 3] = np.where(region_mask > 0, 255, 0).astype(np.uint8)
    Image.fromarray(web_mask, mode="RGBA").save(out_dir / "region_mask_web.png")
    (out_dir / "regions.json").write_text(json.dumps({
        "version": 1,
        "width": W,
        "height": H,
        "maskFormat": "uint16_png",
        "regions": regions_meta,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    if progress:
        progress("package", "running", "正在写入线稿、预览图和关卡配置")
    level = {
        "id": level_id,
        "title": title,
        "subtitle": "由 Coloring Book Line Art 与区域 Mask 生成的关卡",
        "difficulty": "普通",
        "palette": palette,
        "regions": regions,
        "viewBox": f"0 0 {W} {H}",
        "preview": f"/levels/{level_id}/preview.png",
        "lineart": f"/levels/{level_id}/lineart.png",
        "outline": f"/levels/{level_id}/outline.png",
        "regionMask": f"/levels/{level_id}/region_mask.png",
        "regionMaskWeb": f"/levels/{level_id}/region_mask_web.png",
        "regionsMeta": f"/levels/{level_id}/regions.json",
    }
    (out_dir / "level.json").write_text(json.dumps(level, ensure_ascii=False), encoding="utf-8")

    # 与 level.json 的资源契约保持一致：后续导入、审核与复用都能取得实际线稿。
    if line_img is not None:
        line_img.save(out_dir / "lineart.png")

    # 素材: preview = 原图; outline = 透明底线稿(照片模式用区域边界线)
    Image.fromarray(rgb.astype(np.uint8)).save(out_dir / "preview.png")
    if line_img is not None:
        la = np.asarray(line_img, dtype=np.uint8)
        alpha = (255 - la)
    else:
        boundary = np.zeros((H, W), dtype=bool)
        boundary[:-1, :] |= final[:-1, :] != final[1:, :]
        boundary[:, :-1] |= final[:, :-1] != final[:, 1:]
        alpha = dilate(boundary, 1).astype(np.uint8) * 255
    outline = np.zeros((H, W, 4), dtype=np.uint8)
    outline[..., 3] = alpha
    Image.fromarray(outline, "RGBA").save(out_dir / "outline.png")

    # 验证渲染: 每块区域用其 palette 色平铺(等价于游戏内全部填对的效果)
    if progress:
        progress("verify", "running", "正在渲染校验图，检查关卡可用性")
    vis = np.full((H, W, 3), 255, dtype=np.uint8)
    pal_rgb = np.array([[int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)] for c in palette], dtype=np.uint8)
    for reg, (_, _, r) in zip(regions, order):
        vis[final == r] = pal_rgb[reg["color"]]
    vis[lines] = 0
    Image.fromarray(vis).save(out_dir / "verify_fill.png")

    source = {
        "sourceImage": str(color_src), "lineArt": str(line_src) if line_src else None,
        "pipeline": "coloring-book-lineart+lineart-barrier+slic+v2", "params": {
            "workSize": [W, H], "slicSegments": n_seg, "mergeThresh": merge_thresh,
            "minAreaRatio": min_area_ratio, "paletteN": palette_n, "dpEps": DP_EPS,
        },
        "license": "user-provided original artwork",
    }
    (out_dir / "source.json").write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[6/6] 输出完成: {len(regions)} 区域 / {len(palette)} 色 -> {out_dir}", flush=True)
    return level


def main():
    color_src = sys.argv[1]                              # 彩色原图
    line_src = sys.argv[2] if sys.argv[2].lower() != "none" else None  # 线稿, 传 none 为照片模式
    out_dir = sys.argv[3]                                # 输出目录
    level_id = sys.argv[4]
    title = sys.argv[5] if len(sys.argv) > 5 else level_id
    generate_level(color_src, line_src, out_dir, level_id, title)


if __name__ == "__main__":
    main()
