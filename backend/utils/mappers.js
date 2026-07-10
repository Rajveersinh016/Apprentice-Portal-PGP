function mapSheetToInternal(row, isCompleted) {
  const mapped = {
    code: row["Employee Code"] || "",
    name: row["Full Name"] || "",
    location: row["Location"] || "",
    dept: row["Department"] || "",
    joined: row["Joining Date"] ? String(row["Joining Date"]).split("T")[0] : "",
    sex: row["Sex"] || "Male",
    age: row["Age"] ? parseInt(row["Age"]) : 22,
    phone: row["Phone"] || "",
    email: row["Email"] || "",
    address: row["Address"] || "",
    remarks: row["Remarks"] || "",
    contractId: row["Employee Contract ID"] || "Pending",
    portalEnrollmentNumber: row["Portal Enrollment Number"] || "Pending",
    portalName: row["Portal Name"] || "Pending",
    status: isCompleted ? "Completed" : (row["Record Status"] || "Active"),
    completionDate: isCompleted ? (row["Completion Date"] ? String(row["Completion Date"]).split("T")[0] : "") : "",
    completedBy: isCompleted ? (row["Completed By"] || "") : "",
    completionReason: isCompleted ? (row["Completion Reason"] || "") : "",
    otherCompletionReason: isCompleted ? (row["Other Completion Reason"] || "") : "",
    completionRemarks: isCompleted ? (row["Completion Remarks"] || "") : "",
    postApprenticeshipStatus: isCompleted ? (row["Post Apprenticeship Status"] || row["Completion Reason"] || "Completed") : "",
    updatedBy: row["Updated By"] || "",
    updatedDate: row["Updated Date"] || ""
  };

  // Dynamically attach any other fields from the spreadsheet row
  Object.keys(row).forEach(key => {
    if (key.startsWith('__')) return; // skip row number metadata
    if (key === "Completion Details Finalized") return; // Exclude internal system fields
    if (!mapped.hasOwnProperty(key)) {
      mapped[key] = row[key];
    }
  });

  return mapped;
}

module.exports = {
  mapSheetToInternal
};
