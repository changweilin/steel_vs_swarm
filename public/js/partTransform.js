// 執行期零件槽位的純矩陣縫；零 THREE，供型錄工具與客戶端組裝器共用。
export function mat3FromEulerXYZ(rotation = [0, 0, 0]) {
  const [rx = 0, ry = 0, rz = 0] = rotation;
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  return [
    c * e, -c * f, d,
    a * f + b * e * d, a * e - b * f * d, -b * c,
    b * f - a * e * d, b * e + a * f * d, a * c,
  ];
}

export const mat3Transpose = (matrix) => [
  matrix[0], matrix[3], matrix[6],
  matrix[1], matrix[4], matrix[7],
  matrix[2], matrix[5], matrix[8],
];

export const mat3Apply = (matrix, vector) => [
  matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
  matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
  matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
];

export function mat3Multiply(a, b) {
  const out = Array(9).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      for (let k = 0; k < 3; k++) out[row * 3 + column] += a[row * 3 + k] * b[k * 3 + column];
    }
  }
  return out;
}

export function eulerXYZFromMat3(matrix) {
  const y = Math.asin(Math.max(-1, Math.min(1, matrix[2])));
  if (Math.abs(matrix[2]) < 0.9999999) {
    return [Math.atan2(-matrix[5], matrix[8]), y, Math.atan2(-matrix[1], matrix[0])];
  }
  return [Math.atan2(matrix[7], matrix[4]), y, 0];
}
