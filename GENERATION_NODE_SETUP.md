# 数字填色 FN 云端服务

线上用户在数字填色工作坊上传图片后，FN 后端会直接完成图片裁边、调色板提取、像素化、色块编号和关卡文件保存；不再需要启动本机 Python/OpenCV 生成节点。

## 必填的生产环境变量

在 F.New 的 production 环境中配置：

```dotenv
VITE_SDP_APP_ID=你的 SDP 应用 ID
```

- `VITE_SDP_APP_ID`：用于浏览器登录；由 SDP/F.New 应用配置提供。

## 任务链路

```text
登录用户 → FN 对象存储上传原图 → generation-jobs 任务
      → FN 后端裁边 / K-Means 取色 / 像素化 / 写入数字色块
      → 对象存储保存 level.json / 预览 / 完成效果 → 用户导入数字画册
```
