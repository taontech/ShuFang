const weekCount = 13;
const today = new Date("2026-05-26T10:06:00");
const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
const currentWeekStart = new Date(end);
currentWeekStart.setDate(end.getDate() - end.getDay());
const start = new Date(currentWeekStart);
start.setDate(currentWeekStart.getDate() - (weekCount - 1) * 7);

console.log("today:", today.toDateString());

const weeks = Array.from({ length: weekCount }, (_, weekIndex) =>
  Array.from({ length: 7 }, (_, dayIndex) => {
    const date = new Date(start);
    date.setDate(start.getDate() + weekIndex * 7 + dayIndex);
    if (date > end) return null;
    return date;
  })
);

const monthLabels = weeks.map((week, index) => {
  const firstDate = week.find((date) => date !== null);
  if (!firstDate) return "";

  if (index === 0) {
    return firstDate.toLocaleDateString("zh-CN", { month: "short" });
  }

  const prevWeek = weeks[index - 1];
  const prevDate = prevWeek ? prevWeek.find((date) => date !== null) : null;
  if (prevDate && firstDate.getMonth() !== prevDate.getMonth()) {
    return firstDate.toLocaleDateString("zh-CN", { month: "short" });
  }

  return "";
});

console.log("monthLabels:", JSON.stringify(monthLabels));

weeks.forEach((week, i) => {
  console.log(`Week ${i} (label: "${monthLabels[i]}"):`);
  week.forEach((date, d) => {
    console.log(`  Day ${d}: ${date ? date.toDateString() : "null"}`);
  });
});
