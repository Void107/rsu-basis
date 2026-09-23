// 内置合成演示案例（synthetic-001）。全部是构造出来的假数据，可安全打进单文件包。
// 用途：让「断网双击 HTML 跑通全流程」可被当场验证——无需任何真实券商文档。
// 真实 PDF 路径目前在 C1 合计锚点未验证处硬阻断（INDEX.md D16），这是刻意的。
export const DEMO_LEDGER = {
  "schemaVersion": 1,
  "taxYear": 2024,
  "ticker": "ACME",
  "vestLots": [
    {
      "id": "A",
      "grantId": "G1",
      "vestDate": "2024-02-15",
      "sharesVested": "100",
      "sharesWithheld": "40",
      "sharesDelivered": "60",
      "vestFmv": "50.00",
      "ordinaryIncome": "5000.00",
      "fmvConvention": "close",
      "sources": [
        {
          "fileHash": "synthetic",
          "fileName": "synthetic",
          "page": 1,
          "rowIndex": 1,
          "columnLabel": null,
          "method": "manual",
          "confidence": 1.0,
          "rawText": "synthetic"
        }
      ]
    },
    {
      "id": "B",
      "grantId": "G1",
      "vestDate": "2024-05-15",
      "sharesVested": "100",
      "sharesWithheld": "40",
      "sharesDelivered": "60",
      "vestFmv": "62.00",
      "ordinaryIncome": "6200.00",
      "fmvConvention": "close",
      "sources": [
        {
          "fileHash": "synthetic",
          "fileName": "synthetic",
          "page": 1,
          "rowIndex": 2,
          "columnLabel": null,
          "method": "manual",
          "confidence": 1.0,
          "rawText": "synthetic"
        }
      ]
    },
    {
      "id": "C",
      "grantId": "G2",
      "vestDate": "2024-05-15",
      "sharesVested": "60",
      "sharesWithheld": "24",
      "sharesDelivered": "36",
      "vestFmv": "62.00",
      "ordinaryIncome": "3720.00",
      "fmvConvention": "close",
      "sources": [
        {
          "fileHash": "synthetic",
          "fileName": "synthetic",
          "page": 1,
          "rowIndex": 3,
          "columnLabel": null,
          "method": "manual",
          "confidence": 1.0,
          "rawText": "synthetic"
        }
      ]
    },
    {
      "id": "D",
      "grantId": "G1",
      "vestDate": "2024-08-15",
      "sharesVested": "100",
      "sharesWithheld": "40",
      "sharesDelivered": "60",
      "vestFmv": "55.00",
      "ordinaryIncome": "5500.00",
      "fmvConvention": "close",
      "sources": [
        {
          "fileHash": "synthetic",
          "fileName": "synthetic",
          "page": 1,
          "rowIndex": 4,
          "columnLabel": null,
          "method": "manual",
          "confidence": 1.0,
          "rawText": "synthetic"
        }
      ]
    },
    {
      "id": "E",
      "grantId": "G1",
      "vestDate": "2024-11-15",
      "sharesVested": "100",
      "sharesWithheld": "40",
      "sharesDelivered": "60",
      "vestFmv": "70.00",
      "ordinaryIncome": "7000.00",
      "fmvConvention": "close",
      "sources": [
        {
          "fileHash": "synthetic",
          "fileName": "synthetic",
          "page": 1,
          "rowIndex": 5,
          "columnLabel": null,
          "method": "manual",
          "confidence": 1.0,
          "rawText": "synthetic"
        }
      ]
    }
  ],
  "saleEvents": [
    {
      "id": "S1",
      "saleDate": "2024-02-15",
      "sharesSold": "40",
      "proceeds": "2000.00",
      "proceedsBasis": "gross",
      "reportedBasis": "0.00",
      "reportedTerm": "ST",
      "covered": true,
      "saleKind": "sell_to_cover",
      "sources": [],
      "basisReportedToIRS": true
    },
    {
      "id": "S2",
      "saleDate": "2024-05-15",
      "sharesSold": "40",
      "proceeds": "2480.00",
      "proceedsBasis": "gross",
      "reportedBasis": "0.00",
      "reportedTerm": "ST",
      "covered": true,
      "saleKind": "sell_to_cover",
      "sources": [],
      "basisReportedToIRS": true
    },
    {
      "id": "S3",
      "saleDate": "2024-05-15",
      "sharesSold": "24",
      "proceeds": "1488.00",
      "proceedsBasis": "gross",
      "reportedBasis": "0.00",
      "reportedTerm": "ST",
      "covered": true,
      "saleKind": "sell_to_cover",
      "sources": [],
      "basisReportedToIRS": true
    },
    {
      "id": "S4",
      "saleDate": "2024-08-15",
      "sharesSold": "40",
      "proceeds": "2192.00",
      "proceedsBasis": "gross",
      "reportedBasis": "0.00",
      "reportedTerm": "ST",
      "covered": true,
      "saleKind": "sell_to_cover",
      "sources": [],
      "basisReportedToIRS": true
    },
    {
      "id": "S5",
      "saleDate": "2024-11-15",
      "sharesSold": "40",
      "proceeds": "2800.00",
      "proceedsBasis": "gross",
      "reportedBasis": "0.00",
      "reportedTerm": "ST",
      "covered": true,
      "saleKind": "sell_to_cover",
      "sources": [],
      "basisReportedToIRS": true
    },
    {
      "id": "S6",
      "saleDate": "2024-12-10",
      "sharesSold": "200",
      "proceeds": "15000.00",
      "proceedsBasis": "gross",
      "reportedBasis": "0.00",
      "reportedTerm": "ST",
      "covered": true,
      "saleKind": "open_market",
      "sources": [],
      "basisReportedToIRS": true
    }
  ],
  "w2Anchor": {
    "taxYear": 2024,
    "box1Total": null,
    "rsuIncomeReported": "27420.00",
    "rsuIncomeSource": "box14",
    "sources": []
  }
} as const;
